/**
 * `next/cache` for driver scripts. Cache invalidation is meaningless outside a
 * request — there is no route to revalidate — and the real functions throw
 * rather than no-op, which would stop a driver at the first server action that
 * writes anything. Records what would have been invalidated, so a driver can
 * still assert that an action asked for it.
 */
const globalStore = globalThis as unknown as { __kivoRevalidated?: string[] };
globalStore.__kivoRevalidated ??= [];
export const revalidated: string[] = globalStore.__kivoRevalidated;

export function revalidatePath(path: string) {
  revalidated.push(`path:${path}`);
}

export function revalidateTag(tag: string) {
  revalidated.push(`tag:${tag}`);
}

export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
