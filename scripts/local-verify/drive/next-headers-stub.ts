/**
 * `next/headers` for driver scripts. A driver is not a request, so the real
 * module throws the moment anything reaches for a cookie. This returns an
 * empty, in-memory store instead — and records who asked, because a server
 * module reaching for cookies is worth knowing about: anything that does
 * cannot be called from a background worker, only from a request.
 */
// On globalThis on purpose. Depending on how the driver is loaded, the
// application's `next/headers` import and the driver's own import of this file
// can end up as two module instances; a store held in module scope would then
// have the driver seeding one and the application reading the other, empty one.
const globalStore = globalThis as unknown as { __kivoDriveCookies?: Map<string, string>; __kivoCookieReaders?: string[] };
globalStore.__kivoDriveCookies ??= new Map<string, string>();
globalStore.__kivoCookieReaders ??= [];
const store = globalStore.__kivoDriveCookies;

/** Loads a real `Cookie:` header, so a driver can call a server action as a
 * signed-in user rather than as nobody. */
export function seedCookies(header: string) {
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

export function clearCookies() {
  store.clear();
}
export const cookieReaders: string[] = globalStore.__kivoCookieReaders;

function callerOf(): string {
  const stack = new Error().stack?.split("\n") ?? [];
  return (
    stack.find(
      (line) =>
        line.includes("/src/") &&
        !line.includes("next-headers-stub") &&
        !line.includes("/src/lib/supabase/server"),
    ) ?? stack.slice(1).join(" | ")
  );
}

export async function cookies() {
  cookieReaders.push(callerOf().trim());
  return {
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: (name: string, value: string) => { store.set(name, value); },
    delete: (name: string) => { store.delete(name); },
  };
}

export async function headers() {
  return new Map<string, string>() as unknown as Headers;
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}
