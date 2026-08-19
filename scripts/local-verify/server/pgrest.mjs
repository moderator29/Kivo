/**
 * A PostgREST-compatible subset, backed by a direct Postgres connection.
 *
 * WHY THIS EXISTS. KIVO talks to Supabase over PostgREST. To run the real
 * application against a real database with real RLS — rather than against a
 * mock — something has to answer those HTTP calls. Supabase's own containers
 * cannot be pulled in this sandbox (the Docker blob CDN is blocked by egress
 * policy), so this speaks the parts of the protocol the app actually uses.
 *
 * WHAT MAKES IT HONEST. Every request runs inside a transaction that does
 * `set local role` to anon / authenticated / service_role and sets
 * `request.jwt.claims` from the caller's token, exactly as PostgREST does.
 * The policies in supabase/migrations are therefore the real gate: a query
 * this server passes through is a query the live database would also allow.
 *
 * WHAT IT IS NOT. Not a Supabase emulator, and not a substitute for testing
 * against the real thing. Unsupported syntax throws loudly rather than
 * silently returning something plausible — a quiet wrong answer here would be
 * worse than no answer at all.
 */

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function ident(name) {
  if (!IDENT.test(name)) throw new PgrstError(400, "42601", `Unsupported identifier: ${name}`);
  return `"${name}"`;
}

export class PgrstError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.body = { code, message, details: details ?? null, hint: null };
  }
}

// ---------------------------------------------------------------------------
// Catalog: foreign keys and columns, so embedded resources can be resolved the
// way PostgREST resolves them — from the actual constraints.
// ---------------------------------------------------------------------------
export async function loadCatalog(pool) {
  const fks = await pool.query(`
    select
      c.conname                         as constraint_name,
      src.relname                       as src_table,
      tgt.relname                       as tgt_table,
      (select array_agg(a.attname::text order by k.ord)
         from unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as src_cols,
      (select array_agg(a.attname::text order by k.ord)
         from unnest(c.confkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as tgt_cols
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class tgt on tgt.oid = c.confrelid
    join pg_namespace n on n.oid = src.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
  `);
  const columns = await pool.query(`
    select table_name, array_agg(column_name::text) as cols
    from information_schema.columns where table_schema = 'public' group by table_name
  `);
  const pks = await pool.query(`
    select rel.relname as table_name,
           (select array_agg(a.attname::text order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where c.contype = 'p' and n.nspname = 'public'
  `);
  const procs = await pool.query(`
    select p.proname, p.proretset, t.typname as rettype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public'
  `);
  return {
    fks: fks.rows,
    columns: new Map(columns.rows.map((r) => [r.table_name, r.cols])),
    pks: new Map(pks.rows.map((r) => [r.table_name, r.cols])),
    procs: new Map(procs.rows.map((r) => [r.proname, r])),
  };
}

// ---------------------------------------------------------------------------
// select= parsing
// ---------------------------------------------------------------------------
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function parseSelect(select) {
  const nodes = [];
  for (const raw of splitTop(select || "*")) {
    const open = raw.indexOf("(");
    if (open === -1) {
      // plain column, optionally aliased: `alias:column`
      const [left, right] = raw.includes(":") ? [raw.slice(0, raw.indexOf(":")), raw.slice(raw.indexOf(":") + 1)] : [null, raw];
      nodes.push({ kind: "column", alias: left, name: right.trim() });
      continue;
    }
    const head = raw.slice(0, open);
    const inner = raw.slice(open + 1, raw.lastIndexOf(")"));
    let alias = null;
    let rest = head;
    if (head.includes(":")) {
      alias = head.slice(0, head.indexOf(":"));
      rest = head.slice(head.indexOf(":") + 1);
    }
    let hint = null;
    let inner_join = false;
    if (rest.includes("!")) {
      const [table, ...hints] = rest.split("!");
      rest = table;
      for (const h of hints) {
        if (h === "inner") inner_join = true;
        else if (h === "left") inner_join = false;
        else hint = h;
      }
    }
    nodes.push({
      kind: "embed",
      alias: alias || rest.trim(),
      table: rest.trim(),
      hint,
      inner: inner_join,
      children: parseSelect(inner),
    });
  }
  return nodes;
}

/** Which FK links parent to child, and in which direction. */
function resolveRelationship(catalog, parentTable, node) {
  const asChildOfParent = catalog.fks.filter(
    (f) => f.src_table === parentTable && f.tgt_table === node.table,
  );
  const asParentOfChild = catalog.fks.filter(
    (f) => f.src_table === node.table && f.tgt_table === parentTable,
  );
  const matchesHint = (f) =>
    !node.hint || f.constraint_name === node.hint || f.src_cols.includes(node.hint);

  const manyToOne = asChildOfParent.filter(matchesHint);
  const oneToMany = asParentOfChild.filter(matchesHint);

  if (manyToOne.length === 1 && oneToMany.length === 0) {
    return { direction: "many-to-one", fk: manyToOne[0] };
  }
  if (oneToMany.length === 1 && manyToOne.length === 0) {
    return { direction: "one-to-many", fk: oneToMany[0] };
  }
  if (manyToOne.length + oneToMany.length === 0) {
    throw new PgrstError(
      400,
      "PGRST200",
      `Could not find a relationship between '${parentTable}' and '${node.table}'`,
    );
  }
  throw new PgrstError(
    300,
    "PGRST201",
    `More than one relationship was found between '${parentTable}' and '${node.table}' — add a !hint`,
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "and", "or", "not"]);

function parseListLiteral(text) {
  // `(a,b,"c,d")`
  const body = text.replace(/^\(/, "").replace(/\)$/, "");
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "," && !quoted) { out.push(current); current = ""; continue; }
    current += ch;
  }
  if (current !== "" || body.endsWith(",")) out.push(current);
  return out;
}

const OPERATORS = {
  eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=",
  like: "like", ilike: "ilike", match: "~", imatch: "~*",
};

function buildCondition(column, expression, params) {
  let negated = false;
  let rest = expression;
  if (rest.startsWith("not.")) { negated = true; rest = rest.slice(4); }
  const dot = rest.indexOf(".");
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  const col = ident(column);
  let sql;
  if (op in OPERATORS) {
    params.push(value);
    sql = `${col} ${OPERATORS[op]} $${params.length}`;
  } else if (op === "is") {
    if (value === "null") sql = `${col} is null`;
    else if (value === "true" || value === "false") sql = `${col} is ${value}`;
    else throw new PgrstError(400, "PGRST100", `Unsupported is.${value}`);
  } else if (op === "in") {
    const items = parseListLiteral(value);
    if (items.length === 0) { sql = "false"; }
    else {
      const placeholders = items.map((item) => { params.push(item); return `$${params.length}`; });
      sql = `${col}::text in (${placeholders.join(", ")})`;
    }
  } else if (op === "cs") {
    params.push(value.startsWith("{") ? value : JSON.stringify(JSON.parse(value)));
    sql = `${col} @> $${params.length}`;
  } else if (op === "ov") {
    params.push(value);
    sql = `${col} && $${params.length}`;
  } else {
    throw new PgrstError(400, "PGRST100", `Unsupported operator: ${op}`);
  }
  return negated ? `not (${sql})` : sql;
}

function buildLogical(kind, expression, params) {
  const parts = splitTop(expression.replace(/^\(/, "").replace(/\)$/, ""));
  const rendered = parts.map((part) => {
    if (part.startsWith("and(") || part.startsWith("or(")) {
      const k = part.startsWith("and(") ? "and" : "or";
      return buildLogical(k, part.slice(k.length), params);
    }
    const dot = part.indexOf(".");
    return buildCondition(part.slice(0, dot), part.slice(dot + 1), params);
  });
  return `(${rendered.join(` ${kind} `)})`;
}

export function buildWhere(query, params, skip = new Set()) {
  const clauses = [];
  for (const [key, values] of query) {
    if (RESERVED.has(key) && key !== "or" && key !== "and") continue;
    if (skip.has(key)) continue;
    for (const value of [].concat(values)) {
      if (key === "or" || key === "and") clauses.push(buildLogical(key, value, params));
      else if (key.includes(".")) continue; // filter on an embedded table: applied after hydration
      else clauses.push(buildCondition(key, value, params));
    }
  }
  return clauses.length ? `where ${clauses.join(" and ")}` : "";
}

export function buildOrder(orderSpec) {
  const parts = [].concat(orderSpec ?? []).flatMap((spec) => spec.split(","));
  if (parts.length === 0) return "";
  const rendered = parts.map((part) => {
    const [column, ...flags] = part.trim().split(".");
    let sql = ident(column);
    if (flags.includes("desc")) sql += " desc";
    else sql += " asc";
    if (flags.includes("nullsfirst")) sql += " nulls first";
    if (flags.includes("nullslast")) sql += " nulls last";
    return sql;
  });
  return `order by ${rendered.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
function columnList(nodes, table, catalog) {
  const wanted = new Set();
  for (const node of nodes) {
    if (node.kind === "column") {
      if (node.name === "*") return "*";
      wanted.add(node.name);
    } else {
      const rel = resolveRelationship(catalog, table, node);
      if (rel.direction === "many-to-one") rel.fk.src_cols.forEach((c) => wanted.add(c));
      else rel.fk.tgt_cols.forEach((c) => wanted.add(c));
    }
  }
  if (wanted.size === 0) return "*";
  return [...wanted].map(ident).join(", ");
}

function applyProjection(rows, nodes) {
  return rows.map((row) => {
    const out = {};
    for (const node of nodes) {
      if (node.kind === "column") {
        if (node.name === "*") Object.assign(out, row);
        else out[node.alias || node.name] = row[node.name];
      } else {
        out[node.alias] = row[`__embed_${node.alias}`];
      }
    }
    return out;
  });
}

export async function hydrateEmbeds(client, catalog, table, rows, nodes) {
  for (const node of nodes.filter((n) => n.kind === "embed")) {
    const rel = resolveRelationship(catalog, table, node);
    const [srcCol] = rel.fk.src_cols;
    const [tgtCol] = rel.fk.tgt_cols;

    if (rel.direction === "many-to-one") {
      const keys = [...new Set(rows.map((r) => r[srcCol]).filter((v) => v != null))];
      const childRows = keys.length
        ? (await client.query(
            // The join key has to be in the child SELECT even when the caller
            // did not ask for it, or every row comes back unmatched.
            `select ${columnList([...node.children, { kind: "column", name: tgtCol }], node.table, catalog)} from ${ident(node.table)} where ${ident(tgtCol)} = any($1::text[]::${await keyType(client, node.table, tgtCol)}[])`,
            [keys.map(String)],
          )).rows
        : [];
      await hydrateEmbeds(client, catalog, node.table, childRows, node.children);
      const projected = applyProjection(childRows, node.children);
      const byKey = new Map(childRows.map((r, i) => [String(r[tgtCol]), projected[i]]));
      for (const row of rows) row[`__embed_${node.alias}`] = byKey.get(String(row[srcCol])) ?? null;
    } else {
      const keys = [...new Set(rows.map((r) => r[tgtCol]).filter((v) => v != null))];
      const childRows = keys.length
        ? (await client.query(
            `select ${columnList([...node.children, { kind: "column", name: srcCol }], node.table, catalog)} from ${ident(node.table)} where ${ident(srcCol)} = any($1::text[]::${await keyType(client, node.table, srcCol)}[])`,
            [keys.map(String)],
          )).rows
        : [];
      await hydrateEmbeds(client, catalog, node.table, childRows, node.children);
      const projected = applyProjection(childRows, node.children);
      const grouped = new Map();
      childRows.forEach((r, i) => {
        const k = String(r[srcCol]);
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k).push(projected[i]);
      });
      for (const row of rows) row[`__embed_${node.alias}`] = grouped.get(String(row[tgtCol])) ?? [];
    }
  }
}

const typeCache = new Map();
async function keyType(client, table, column) {
  const cacheKey = `${table}.${column}`;
  if (typeCache.has(cacheKey)) return typeCache.get(cacheKey);
  const { rows } = await client.query(
    `select format_type(a.atttypid, a.atttypmod) as t
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and a.attname = $2`,
    [table, column],
  );
  const type = rows[0]?.t ?? "text";
  typeCache.set(cacheKey, type);
  return type;
}

/** Drops rows whose `!inner` embed came back empty, as PostgREST's inner join does. */
export function applyInnerJoins(rows, nodes) {
  return rows.filter((row) =>
    nodes.every((node) => {
      if (node.kind !== "embed" || !node.inner) return true;
      const value = row[`__embed_${node.alias}`];
      return Array.isArray(value) ? value.length > 0 : value != null;
    }),
  );
}

export { applyProjection, columnList, ident };
