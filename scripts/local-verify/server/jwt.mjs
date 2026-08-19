// Local-only token minting. The secret is a constant on purpose: this server
// only ever listens on loopback, in front of a throwaway database.
import { SignJWT, jwtVerify } from "jose";

export const JWT_SECRET = new TextEncoder().encode(
  "kivo-local-verify-jwt-secret-not-used-anywhere-real-0123456789",
);

export async function mint(claims, ttlSeconds = 3600, issuedAt = null) {
  const now = issuedAt ?? Math.floor(Date.now() / 1000);
  return await new SignJWT({ ...claims, iat: now, exp: now + ttlSeconds })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(JWT_SECRET);
}

export async function verify(token) {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload;
}

// The two API keys, shaped like Supabase's: JWTs whose `role` claim is the
// Postgres role the request runs as.
// Fixed issue time so the keys are byte-identical across restarts: they get
// written into an env file, and a key that changed every boot would silently
// leave a running dev server pointed at a token this process no longer mints.
const KEY_EPOCH = 1_700_000_000;
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
export const ANON_KEY = await mint({ iss: "kivo-local", role: "anon" }, TEN_YEARS, KEY_EPOCH);
export const SERVICE_KEY = await mint({ iss: "kivo-local", role: "service_role" }, TEN_YEARS, KEY_EPOCH);
