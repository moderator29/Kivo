/**
 * A stand-in for the Supabase query builder, for testing server actions.
 *
 * KN-130. 31 files carry `"use server"` and none of them had a test. The gap
 * that matters is not "does this write the right row" — RLS is the real
 * guarantee there, and it is tested separately. It is **authorization and
 * lock enforcement in application code**: `submitPrediction`'s kickoff lock,
 * `setGameweekRoster`'s deadline and ownership checks, `reportContent`'s
 * self-report rule, every admin action's role gate. Those are pure decisions
 * made from data, sitting behind one dependency, and a bug in any of them is
 * silent — the action returns `{ error: null }` and the wrong thing happens.
 *
 * Deliberately a hand-written double rather than a mocking library. The
 * builder's surface used by these actions is small and stable
 * (`from().select().eq().in().maybeSingle()`, plus `upsert`/`insert`/`update`/
 * `delete`), and a hand-written one fails loudly when an action starts using a
 * method nobody accounted for, instead of silently returning `undefined` and
 * producing a green test for code that would throw in production.
 *
 * Results are queued per table, so an action that reads `fixtures` once and
 * then writes `predictions` gets each in the order it asks. An unqueued table
 * throws, naming the table — a test that forgot to set one up should fail with
 * "no result queued for fixtures", not with "cannot read property of null"
 * fifty lines away.
 */

export type QueryResult = { data?: unknown; error?: unknown; count?: number | null };

type Queue = Map<string, QueryResult[]>;

export type RecordedCall = {
  table: string;
  /** The builder methods called, in order, e.g. ["select", "eq", "maybeSingle"]. */
  chain: string[];
  /** Arguments of the first mutating call, when there was one. */
  payload?: unknown;
};

const TERMINAL = new Set(["maybeSingle", "single", "then"]);
const MUTATIONS = new Set(["insert", "upsert", "update", "delete"]);

export function createSupabaseDouble(results: Record<string, QueryResult | QueryResult[]>) {
  const queue: Queue = new Map();
  for (const [table, value] of Object.entries(results)) {
    queue.set(table, Array.isArray(value) ? [...value] : [value]);
  }

  const calls: RecordedCall[] = [];

  function take(table: string): QueryResult {
    const pending = queue.get(table);
    if (!pending || pending.length === 0) {
      throw new Error(
        `Supabase double: no result queued for table "${table}". ` +
          `Queue one in createSupabaseDouble({ ${table}: { data: ... } }).`,
      );
    }
    // The last queued result repeats, so a test does not have to count how
    // many times an action happens to read the same table.
    return pending.length === 1 ? pending[0] : pending.shift()!;
  }

  function builder(table: string) {
    const record: RecordedCall = { table, chain: [] };
    calls.push(record);

    const chainable = [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "gt",
      "gte",
      "lt",
      "lte",
      "order",
      "limit",
      "range",
      "filter",
      "not",
      "or",
      "match",
    ];

    const target: Record<string, unknown> = {};

    for (const method of chainable) {
      target[method] = (...args: unknown[]) => {
        record.chain.push(method);
        if (method === "select" && record.payload === undefined && args.length > 1) record.payload = args[1];
        return proxy;
      };
    }

    for (const method of MUTATIONS) {
      target[method] = (...args: unknown[]) => {
        record.chain.push(method);
        record.payload = args[0];
        return proxy;
      };
    }

    for (const method of TERMINAL) {
      if (method === "then") continue;
      target[method] = async () => {
        record.chain.push(method);
        return take(table);
      };
    }

    // Awaiting the builder itself (no .single()) is how most writes resolve.
    target.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => {
      try {
        record.chain.push("await");
        return Promise.resolve(take(table)).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    };

    const proxy = new Proxy(target, {
      get(object, property) {
        if (typeof property === "string" && !(property in object)) {
          throw new Error(
            `Supabase double: unsupported builder method ".${property}()" on "${table}". ` +
              `Add it to src/lib/supabase/query-double.ts rather than letting the test pass on undefined.`,
          );
        }
        return Reflect.get(object, property);
      },
    });

    return proxy;
  }

  const auth = {
    getUser: async () => take("auth.getUser"),
    signOut: async (options?: { scope?: string }) => {
      calls.push({ table: "auth.signOut", chain: [options?.scope ?? "global"] });
      return take("auth.signOut");
    },
  };

  return {
    client: {
      from: (table: string) => builder(table),
      auth,
      rpc: async (name: string) => {
        calls.push({ table: `rpc.${name}`, chain: [] });
        return take(`rpc.${name}`);
      },
    },
    /** Every builder that was created, for asserting what an action did NOT do. */
    calls,
    /** Did the action write to this table at all? */
    wrote(table: string) {
      return calls.some((call) => call.table === table && call.chain.some((step) => MUTATIONS.has(step)));
    },
  };
}
