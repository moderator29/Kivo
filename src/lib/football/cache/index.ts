/**
 * The provider cache, as one import.
 *
 * `resource-classes.ts` is the policy (no database, no server-only, unit
 * testable); `provider-cache.ts` is the machinery (server-only). Consumers
 * almost always want both, and keeping the split visible here rather than
 * flattening it means a test can still reach the policy without the machinery.
 */
export {
  RESOURCE_POLICIES,
  classesInvalidatedByFinishedMatch,
  matchResourceClass,
  resourcePolicy,
  type RequestBucketName,
  type ResourceClass,
  type ResourcePolicy,
} from "./resource-classes";

export {
  invalidateOnMatchCompletion,
  pruneProviderCache,
  withProviderCache,
  type CacheState,
  type CachedResult,
  type FetchContext,
  type WithProviderCacheOptions,
} from "./provider-cache";
