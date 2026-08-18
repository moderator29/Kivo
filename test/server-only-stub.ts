/**
 * `server-only` throws when imported outside a React Server Component build.
 * Vitest runs in plain Node, so any module carrying that guard — which is most
 * of `src/lib` and every server action — cannot be imported by a test at all
 * without this stub standing in for it.
 *
 * Aliased in vitest.config.mts. Empty on purpose: the real package's entire job
 * is to fail a *bundle* that pulls server code into the client, and a test
 * process is neither.
 */
export {};
