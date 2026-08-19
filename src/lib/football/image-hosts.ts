/**
 * The single source of truth for every remote host KIVO is allowed to load an
 * image from.
 *
 * Why this file exists (KIVO_NEXT_GEN KN-1/KN-2): the same host list has to
 * appear in two completely different places in `next.config.ts` —
 * `images.remotePatterns` (which governs the call sites that route through
 * next/image's optimizer) and the CSP's `img-src` directive (which governs the
 * call sites that pass `unoptimized` and therefore fetch the provider host
 * straight from the browser). Those two lists were maintained by hand and drifted:
 * `media.api-sports.io` was in `remotePatterns` and missing from `img-src` for
 * long enough that every crest and player photo in the product would have been
 * blocked outright the moment a real sync ran. Deriving both lists from the
 * constants below makes that particular drift structurally impossible rather
 * than something a future reviewer has to remember.
 *
 * Deliberately dependency-free and free of `server-only`: `next.config.ts`
 * imports it at config-load time, and its unit tests import it directly.
 */

/**
 * API-Football's image CDN — every team crest, player headshot and competition
 * logo the primary provider returns. Verified against real response payloads
 * (see src/lib/football/providers/normalizers.ts).
 */
export const API_FOOTBALL_IMAGE_HOST = "media.api-sports.io";

/**
 * The one Clerk host that survived the 2026-08-18 auth migration, and only in
 * `img-src`. `profiles.avatar_url` still holds Clerk-hosted photo URLs on rows
 * created before the migration; nothing writes that column any more, but
 * resolveAvatarSrc() (src/lib/kivo-assets.ts) still renders them as a
 * last-resort fallback, including to other users on public profiles. It is NOT
 * a football provider host, so it never belongs in `remotePatterns` — those
 * avatars are rendered with `unoptimized`.
 */
export const LEGACY_AVATAR_HOSTS = ["img.clerk.com"] as const;

/**
 * The env var the founder sets alongside `FOOTBALL_DATA_PROVIDER` when
 * switching to a provider whose image host this repo cannot verify from here.
 *
 * This is not a convenience knob, it is the honest answer to a real
 * constraint. TheSportsDB is a fully implemented provider
 * (src/lib/football/providers/thesportsdb.ts) whose normalizers map
 * `strBadge`/`strHomeTeamBadge`/`strAwayTeamBadge` — but thesportsdb.com is
 * unreachable from every sandbox this codebase has been built in (the egress
 * proxy answers 403 to CONNECT), so the hostname those URLs actually resolve
 * to has never been read off a real response. Hardcoding a guess would be
 * exactly the kind of unverified assertion this product's first rule forbids,
 * and a wrong guess in `remotePatterns` degrades silently to a 400 per image.
 * So: no guess. The host is configuration, set once from a real payload, and
 * documented in ENVIRONMENT.md.
 *
 * Comma-separated bare hostnames, e.g. `r2.example.com,images.example.com`.
 */
export const EXTRA_IMAGE_HOSTS_ENV = "FOOTBALL_IMAGE_HOSTS";

/**
 * Accepts a bare hostname only — no scheme, no path, no port, no wildcard.
 *
 * Wildcards are rejected on purpose. `remotePatterns` supports `*.example.com`
 * and it is tempting to allow it here, but this value also lands verbatim in a
 * CSP `img-src` directive, where a mistyped entry widens the policy for the
 * whole app. A hostname that has to be written out in full cannot accidentally
 * become `*` or `https://*`.
 */
export function isValidImageHost(value: string): boolean {
  return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
}

/**
 * Parses `FOOTBALL_IMAGE_HOSTS`. Invalid entries are dropped with a warning
 * rather than throwing: a typo in an optional env var should not take a
 * production build down, and the resulting missing image is visible and
 * debuggable. Returns de-duplicated, lower-cased hostnames in input order.
 */
export function parseExtraImageHosts(
  raw: string | undefined | null,
  onInvalid?: (value: string) => void,
): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const host = part.trim().toLowerCase();
    if (!host) continue;
    if (!isValidImageHost(host)) {
      onInvalid?.(host);
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

/**
 * Hosts that serve football provider imagery. These are the ones that need to
 * be in BOTH `remotePatterns` and `img-src`.
 */
export function footballImageHosts(
  extraHostsRaw?: string | null,
  onInvalid?: (value: string) => void,
): string[] {
  const extras = parseExtraImageHosts(extraHostsRaw, onInvalid);
  return [API_FOOTBALL_IMAGE_HOST, ...extras.filter((h) => h !== API_FOOTBALL_IMAGE_HOST)];
}

/**
 * Everything the CSP's `img-src` must allow, as full `https://host` origins:
 * the football provider hosts, plus the legacy avatar host, plus (when
 * configured) the Supabase origin that serves the public `avatars` bucket.
 * `'self'`, `data:` and `blob:` are added by the caller — they are not hosts.
 */
export function imgSrcOrigins(options: {
  extraHostsRaw?: string | null;
  supabaseOrigin?: string | null;
  onInvalid?: (value: string) => void;
}): string[] {
  const origins = [
    ...footballImageHosts(options.extraHostsRaw, options.onInvalid).map((h) => `https://${h}`),
    ...LEGACY_AVATAR_HOSTS.map((h) => `https://${h}`),
  ];
  if (options.supabaseOrigin) origins.push(options.supabaseOrigin);
  return origins;
}

/** `images.remotePatterns` entries for every football provider host. */
export function remoteImagePatterns(
  extraHostsRaw?: string | null,
  onInvalid?: (value: string) => void,
): { protocol: "https"; hostname: string }[] {
  return footballImageHosts(extraHostsRaw, onInvalid).map((hostname) => ({
    protocol: "https" as const,
    hostname,
  }));
}

/**
 * The one combination where an unset `FOOTBALL_IMAGE_HOSTS` is a real fault
 * rather than an unused option — and it currently fails in silence.
 *
 * `media.api-sports.io` is built in, so API-Football needs no configuration.
 * TheSportsDB's badge CDN is not built in and deliberately never will be until
 * somebody reads the hostname off a real response (see EXTRA_IMAGE_HOSTS_ENV
 * above). Selecting that provider without setting the host produces a product
 * where every crest is blocked by KIVO's own Content-Security-Policy and every
 * optimized image answers 400 — with no error anywhere. The founder sees
 * missing crests and reasonably concludes the sync did not run, which is the
 * wrong conclusion and sends the debugging in the wrong direction entirely.
 *
 * Returned as a string rather than logged here so both callers can use it: the
 * build (`next.config.ts`, where the value is actually read) and the running
 * server (`getFootballDataProvider`, which is where the choice takes effect and
 * where a founder who did not watch the build log will still see it).
 *
 * The redeploy sentence is not padding. This value is read at build time, so
 * setting it in the dashboard and waiting changes nothing.
 */
export function missingImageHostWarning(options: {
  provider: string | null | undefined;
  extraHostsRaw: string | null | undefined;
}): string | null {
  if (options.provider !== "thesportsdb") return null;
  if (parseExtraImageHosts(options.extraHostsRaw).length > 0) return null;
  return (
    `FOOTBALL_DATA_PROVIDER=thesportsdb but ${EXTRA_IMAGE_HOSTS_ENV} is empty. ` +
    `Only ${API_FOOTBALL_IMAGE_HOST} is allowed by default, so every crest and player photo ` +
    `TheSportsDB serves will be blocked by the Content-Security-Policy and return 400 from the ` +
    `image optimizer — silently, as a missing image rather than an error. ` +
    `Read the hostname off one real strBadge/strTeamBadge URL, set ${EXTRA_IMAGE_HOSTS_ENV} to it, ` +
    `and redeploy: this value is read at build time, so saving it without a fresh build changes nothing.`
  );
}
