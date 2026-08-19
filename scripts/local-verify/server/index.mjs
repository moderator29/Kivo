/**
 * The local Supabase-shaped endpoint: PostgREST subset + the slice of GoTrue
 * KIVO's sign-in flow uses, in front of the local verification database.
 *
 * Start it, point NEXT_PUBLIC_SUPABASE_URL at it, and the application runs
 * unmodified against real rows, real RLS and real SQL. See ./pgrest.mjs for
 * what "real RLS" means here and where the fidelity ends.
 */
import http from "node:http";
import pg from "pg";
import { ANON_KEY, SERVICE_KEY, mint, verify } from "./jwt.mjs";
import {
  PgrstError, applyInnerJoins, applyProjection, buildOrder, buildWhere,
  columnList, hydrateEmbeds, ident, loadCatalog, parseSelect,
} from "./pgrest.mjs";

const PORT = Number(process.env.KIVO_LOCAL_API_PORT || 54321);
const DB = process.env.KIVO_LOCAL_DB || "kivo_verify";

// uuid/text columns come back as strings; numerics as strings by default,
// which is not what the app expects from PostgREST's JSON.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const pool = new pg.Pool({
  database: DB,
  user: process.env.PGUSER || "root",
  host: process.env.PGHOST || "/var/run/postgresql",
  max: 12,
});
const catalog = await loadCatalog(pool);

// ---------------------------------------------------------------------------
// Request identity
// ---------------------------------------------------------------------------
async function identify(headers) {
  const bearer = (headers.authorization || "").replace(/^Bearer /i, "").trim();
  const apikey = (headers.apikey || "").trim();
  const token = bearer || apikey;
  if (!token) return { role: "anon", claims: null };
  try {
    const claims = await verify(token);
    const role = claims.role || "authenticated";
    return { role, claims: claims.sub ? claims : null };
  } catch {
    throw new PgrstError(401, "PGRST301", "JWT verification failed");
  }
}

/** Runs the callback with the caller's role and claims applied, as PostgREST does. */
async function asCaller({ role, claims }, callback) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${ident(role)}`);
    if (claims) await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------
function embeddedFilters(query) {
  const out = [];
  for (const [key, values] of query) {
    if (!key.includes(".") || key === "order") continue;
    for (const value of [].concat(values)) {
      const [alias, column] = key.split(".");
      // `.or(..., { referencedTable: "fixtures" })` arrives as `fixtures.or=(a.eq.1,b.eq.2)`.
      if (column === "or" || column === "and") {
        out.push({ alias, logical: column, terms: parseEmbeddedTerms(value) });
        continue;
      }
      const [op, ...rest] = value.split(".");
      out.push({ alias, column, op, value: rest.join(".") });
    }
  }
  return out;
}

function parseEmbeddedTerms(expression) {
  const body = expression.replace(/^\(/, "").replace(/\)$/, "");
  return body.split(",").map((part) => {
    const [column, op, ...rest] = part.trim().split(".");
    return { column, op, value: rest.join(".") };
  });
}

function passesEmbeddedFilter(row, filter) {
  const embedded = row[filter.alias];
  const check = (candidate) => {
    if (candidate == null) return false;
    if (filter.logical) {
      const results = filter.terms.map((term) => matchTerm(candidate[term.column], term));
      return filter.logical === "or" ? results.some(Boolean) : results.every(Boolean);
    }
    const actual = candidate[filter.column];
    switch (filter.op) {
      case "eq": return String(actual) === filter.value;
      case "neq": return String(actual) !== filter.value;
      case "is": return filter.value === "null" ? actual == null : String(actual) === filter.value;
      case "gt": return actual > filter.value;
      case "gte": return actual >= filter.value;
      case "lt": return actual < filter.value;
      case "lte": return actual <= filter.value;
      case "in": return filter.value.replace(/[()"]/g, "").split(",").includes(String(actual));
      default: throw new PgrstError(400, "PGRST100", `Unsupported embedded operator ${filter.op}`);
    }
  };
  return Array.isArray(embedded) ? embedded.some(check) : check(embedded);
}

function matchTerm(actual, term) {
  switch (term.op) {
    case "eq": return String(actual) === term.value;
    case "neq": return String(actual) !== term.value;
    case "is": return term.value === "null" ? actual == null : String(actual) === term.value;
    case "gt": return actual > term.value;
    case "gte": return actual >= term.value;
    case "lt": return actual < term.value;
    case "lte": return actual <= term.value;
    case "in": return term.value.replace(/[()"]/g, "").split(",").includes(String(actual));
    default: throw new PgrstError(400, "PGRST100", `Unsupported embedded operator ${term.op}`);
  }
}

async function handleRead(client, table, query, headers) {
  const nodes = parseSelect(query.get("select") || "*");
  const params = [];
  const where = buildWhere(query, params);
  const order = buildOrder(query.getAll("order"));
  const limit = query.get("limit") ? ` limit ${Number(query.get("limit"))}` : "";
  const offset = query.get("offset") ? ` offset ${Number(query.get("offset"))}` : "";

  const wantsCount = (headers.prefer || "").includes("count=");
  const filters = embeddedFilters(query);
  const joinsOrFiltersOnEmbeds = filters.length > 0 || nodes.some((n) => n.kind === "embed" && n.inner);
  let total = null;
  if (wantsCount && !joinsOrFiltersOnEmbeds) {
    const { rows } = await client.query(`select count(*)::int as n from ${ident(table)} ${where}`, params);
    total = rows[0].n;
  } else if (wantsCount) {
    // The count has to survive the join. PostgREST evaluates the embedded
    // filter and the inner join in the same statement, so `count=exact` on
    // `lineups?fixture.competition_id=eq.X` counts that competition's lineups
    // and not the whole table. Counting before the filter reported every
    // competition's rows on every competition's page — a wrong number
    // presented as a fact, which is worse than no number.
    const countRows = (await client.query(
      `select ${columnList(nodes, table, catalog)} from ${ident(table)} ${where}`,
      params,
    )).rows;
    await hydrateEmbeds(client, catalog, table, countRows, nodes);
    let counted = applyProjection(applyInnerJoins(countRows, nodes), nodes);
    for (const filter of filters) counted = counted.filter((row) => passesEmbeddedFilter(row, filter));
    total = counted.length;
  }

  const sql = `select ${columnList(nodes, table, catalog)} from ${ident(table)} ${where} ${order}${limit}${offset}`;
  if (process.env.KIVO_LOCAL_TRACE) console.log(`[sql] ${sql} :: ${JSON.stringify(params)}`);
  const { rows } = await client.query(sql, params);
  await hydrateEmbeds(client, catalog, table, rows, nodes);
  let projected = applyProjection(applyInnerJoins(rows, nodes), nodes);
  for (const filter of filters) {
    projected = projected.filter((row) => passesEmbeddedFilter(row, filter));
  }
  return { rows: projected, total };
}

function bodyRows(body) {
  if (body == null) return [];
  return Array.isArray(body) ? body : [body];
}

async function handleInsert(client, table, query, headers, body) {
  const rows = bodyRows(body);
  if (rows.length === 0) return { rows: [], total: null };
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const types = await loadColumnTypes(table);
  const params = [];
  const values = rows
    .map((row) => `(${columns.map((c) => { params.push(normalizeFor(types, c, row[c])); return `$${params.length}`; }).join(", ")})`)
    .join(", ");

  const prefer = headers.prefer || "";
  let conflict = "";
  if (prefer.includes("resolution=merge-duplicates")) {
    const target = query.get("on_conflict")
      ? query.get("on_conflict").split(",")
      : catalog.pks.get(table) || [];
    const updates = columns.filter((c) => !target.includes(c));
    conflict = ` on conflict (${target.map(ident).join(", ")}) do ${
      updates.length ? `update set ${updates.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}` : "nothing"
    }`;
  } else if (prefer.includes("resolution=ignore-duplicates")) {
    conflict = " on conflict do nothing";
  }

  const returning = prefer.includes("return=representation") ? " returning *" : "";
  const sql = `insert into ${ident(table)} (${columns.map(ident).join(", ")}) values ${values}${conflict}${returning}`;
  const result = await client.query(sql, params);
  if (!returning) return { rows: [], total: null };
  const nodes = parseSelect(query.get("select") || "*");
  await hydrateEmbeds(client, catalog, table, result.rows, nodes);
  return { rows: applyProjection(result.rows, nodes), total: null };
}

// node-postgres serialises a JS array to a Postgres array literal, which is
// right for text[]/uuid[] and wrong for jsonb — where `["a","b"]` has to stay
// JSON. PostgREST knows the column type; so does this, from the catalog.
const columnTypes = new Map();
async function loadColumnTypes(table) {
  if (columnTypes.has(table)) return columnTypes.get(table);
  const { rows } = await pool.query(
    `select column_name, udt_name from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  const map = new Map(rows.map((r) => [r.column_name, r.udt_name]));
  columnTypes.set(table, map);
  return map;
}

function normalizeFor(types, column, value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  const type = types?.get(column);
  if (type === "json" || type === "jsonb") return JSON.stringify(value);
  return value;
}

function normalize(value) {
  return value === undefined ? null : value;
}

async function handleUpdate(client, table, query, headers, body) {
  const patch = Array.isArray(body) ? body[0] : body;
  const columns = Object.keys(patch || {});
  if (columns.length === 0) throw new PgrstError(400, "PGRST102", "Empty update payload");
  const types = await loadColumnTypes(table);
  const params = [];
  const assignments = columns.map((c) => { params.push(normalizeFor(types, c, patch[c])); return `${ident(c)} = $${params.length}`; });
  const where = buildWhere(query, params);
  const returning = (headers.prefer || "").includes("return=representation") ? " returning *" : "";
  const result = await client.query(`update ${ident(table)} set ${assignments.join(", ")} ${where}${returning}`, params);
  if (!returning) return { rows: [], total: null };
  const nodes = parseSelect(query.get("select") || "*");
  await hydrateEmbeds(client, catalog, table, result.rows, nodes);
  return { rows: applyProjection(result.rows, nodes), total: null };
}

async function handleDelete(client, table, query, headers) {
  const params = [];
  const where = buildWhere(query, params);
  const returning = (headers.prefer || "").includes("return=representation") ? " returning *" : "";
  const result = await client.query(`delete from ${ident(table)} ${where}${returning}`, params);
  return { rows: returning ? result.rows : [], total: null };
}

async function handleRpc(client, name, body, query) {
  const proc = catalog.procs.get(name);
  if (!proc) throw new PgrstError(404, "PGRST202", `Could not find the function public.${name}`);
  const args = body && typeof body === "object" ? body : {};
  const params = [];
  const named = Object.entries(args).map(([key, value]) => {
    params.push(normalize(value));
    return `${ident(key)} => $${params.length}`;
  });
  const call = `${ident(name)}(${named.join(", ")})`;
  if (proc.proretset || proc.rettype === "record") {
    const { rows } = await client.query(`select * from ${call}`, params);
    const nodes = parseSelect(query.get("select") || "*");
    return { rows: query.get("select") ? applyProjection(rows, nodes) : rows, total: null };
  }
  const { rows } = await client.query(`select ${call} as value`, params);
  return { scalar: rows[0]?.value ?? null };
}

// ---------------------------------------------------------------------------
// Auth (the OTP flow KIVO uses, and nothing else)
// ---------------------------------------------------------------------------
const otps = new Map();      // email -> code
const refreshTokens = new Map(); // refresh token -> user id

async function findOrCreateUser(email) {
  const existing = await pool.query("select id, email from auth.users where email = $1", [email]);
  if (existing.rows.length) return existing.rows[0];
  const created = await pool.query("insert into auth.users (email) values ($1) returning id, email", [email]);
  return created.rows[0];
}

async function sessionFor(user) {
  const accessToken = await mint({
    iss: "kivo-local", sub: user.id, email: user.email, role: "authenticated",
    aud: "authenticated", session_id: user.id, is_anonymous: false,
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
  });
  const refreshToken = `local-refresh-${user.id}-${Date.now()}`;
  refreshTokens.set(refreshToken, user.id);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refreshToken,
    user: userPayload(user),
  };
}

function userPayload(user) {
  return {
    id: user.id, aud: "authenticated", role: "authenticated", email: user.email,
    email_confirmed_at: new Date().toISOString(), phone: "",
    confirmed_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
    identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    is_anonymous: false,
  };
}

async function handleAuth(pathname, method, query, body, headers, send) {
  if (pathname === "/auth/v1/otp" && method === "POST") {
    const email = body?.email;
    const code = "123456";
    otps.set(email, code);
    await findOrCreateUser(email);
    console.log(`[auth] OTP for ${email}: ${code}`);
    return send(200, {});
  }
  if (pathname === "/auth/v1/verify" && method === "POST") {
    const email = body?.email;
    if (!email || (otps.get(email) !== body?.token && body?.token !== "123456")) {
      return send(403, { error: "otp_expired", error_description: "Token has expired or is invalid" });
    }
    otps.delete(email);
    return send(200, await sessionFor(await findOrCreateUser(email)));
  }
  if (pathname === "/auth/v1/token" && method === "POST") {
    if (query.get("grant_type") === "refresh_token") {
      const userId = refreshTokens.get(body?.refresh_token);
      if (!userId) return send(400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      const { rows } = await pool.query("select id, email from auth.users where id = $1", [userId]);
      return send(200, await sessionFor(rows[0]));
    }
    return send(400, { error: "unsupported_grant_type" });
  }
  if (pathname === "/auth/v1/user") {
    const token = (headers.authorization || "").replace(/^Bearer /i, "");
    try {
      const claims = await verify(token);
      const { rows } = await pool.query("select id, email from auth.users where id = $1", [claims.sub]);
      if (!rows.length) return send(404, { message: "User not found" });
      return send(200, userPayload(rows[0]));
    } catch {
      return send(401, { message: "invalid claim: missing sub claim" });
    }
  }
  if (pathname === "/auth/v1/logout") return send(204, null);
  if (pathname === "/auth/v1/settings") return send(200, { external: {}, disable_signup: false, mailer_autoconfirm: true });
  if (pathname.endsWith("/.well-known/jwks.json")) return send(200, { keys: [] });
  return send(404, { message: `Unhandled auth route ${pathname}` });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const url = new URL(req.url, "http://localhost");
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }

    const send = (status, payload, extraHeaders = {}) => {
      const headers = { "content-type": "application/json; charset=utf-8", ...extraHeaders };
      res.writeHead(status, headers);
      res.end(payload === null ? "" : JSON.stringify(payload));
    };

    try {
      if (url.pathname.startsWith("/auth/")) {
        return await handleAuth(url.pathname, req.method, url.searchParams, body, req.headers, send);
      }
      if (!url.pathname.startsWith("/rest/v1/")) return send(404, { message: "Not found" });

      const identity = await identify(req.headers);
      const target = url.pathname.slice("/rest/v1/".length);
      const query = url.searchParams;

      const outcome = await asCaller(identity, async (client) => {
        if (target.startsWith("rpc/")) return handleRpc(client, target.slice(4), body, query);
        const table = target;
        if (req.method === "GET" || req.method === "HEAD") return handleRead(client, table, query, req.headers);
        if (req.method === "POST") return handleInsert(client, table, query, req.headers, body);
        if (req.method === "PATCH") return handleUpdate(client, table, query, req.headers, body);
        if (req.method === "DELETE") return handleDelete(client, table, query, req.headers);
        throw new PgrstError(405, "PGRST105", `Unsupported method ${req.method}`);
      });

      if ("scalar" in outcome) return send(200, outcome.scalar);

      const wantsObject = (req.headers.accept || "").includes("vnd.pgrst.object");
      const extra = {};
      if (outcome.total != null) {
        const end = Math.max(outcome.rows.length - 1, 0);
        extra["content-range"] = `0-${end}/${outcome.total}`;
      }
      if (wantsObject) {
        if (outcome.rows.length === 1) return send(200, outcome.rows[0], extra);
        if (outcome.rows.length === 0) {
          return send(406, {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
            details: "The result contains 0 rows",
            hint: null,
          }, extra);
        }
        return send(406, {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: `The result contains ${outcome.rows.length} rows`,
          hint: null,
        }, extra);
      }
      if (req.method === "HEAD") { res.writeHead(200, extra); return res.end(); }
      return send(req.method === "POST" ? 201 : 200, outcome.rows, extra);
    } catch (error) {
      if (error instanceof PgrstError) return send(error.status, error.body);
      const code = error.code || "XX000";
      const status = code === "42501" ? 403 : code?.startsWith("23") ? 409 : 400;
      console.error(`[rest] ${req.method} ${req.url} -> ${code} ${error.message}`);
      if (process.env.KIVO_LOCAL_TRACE) console.error(error.stack);
      return send(status, { code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null });
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`kivo local supabase shim on http://localhost:${PORT} (database ${DB})`);
  console.log(`ANON_KEY=${ANON_KEY}`);
  console.log(`SERVICE_KEY=${SERVICE_KEY}`);
});
