import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * site-url.ts reads process.env at call time and memoises only its warning, so
 * each test resets the module registry to get a clean warning latch and sets
 * the environment it wants explicitly.
 */
const ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "NODE_ENV",
] as const;

let saved: Record<string, string | undefined>;

async function load() {
  vi.resetModules();
  return import("./site-url");
}

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  // Cast: @types/node declares NODE_ENV readonly, but overriding it per-test is
  // the whole point here — siteUrl()'s production-only warning has no other seam.
  const env = process.env as Record<string, string | undefined>;
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  const env = process.env as Record<string, string | undefined>;
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe("siteUrl", () => {
  it("prefers an explicitly configured NEXT_PUBLIC_APP_URL", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://kivo.app", VERCEL_PROJECT_PRODUCTION_URL: "other.vercel.app" });
    const { siteUrl } = await load();
    expect(siteUrl()).toBe("https://kivo.app");
  });

  it("strips a trailing slash so callers can append a path directly", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://kivo.app/" });
    const { siteUrl, absoluteUrl } = await load();
    expect(siteUrl()).toBe("https://kivo.app");
    expect(absoluteUrl("/matches/abc")).toBe("https://kivo.app/matches/abc");
  });

  // The KN-20 case: Vercel resolves a declared-but-unvalued variable to "",
  // and `"" || fallback` is what the four old call sites relied on.
  it("treats an empty NEXT_PUBLIC_APP_URL as unset rather than as a URL", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "kivo.vercel.app" });
    const { siteUrl } = await load();
    expect(siteUrl()).toBe("https://kivo.vercel.app");
  });

  it("adds a scheme to Vercel's bare-hostname system variables", async () => {
    setEnv({ VERCEL_PROJECT_PRODUCTION_URL: "kivo.vercel.app" });
    const { siteUrl } = await load();
    expect(siteUrl()).toBe("https://kivo.vercel.app");
  });

  it("falls back to localhost and never throws when nothing is configured", async () => {
    setEnv({ NODE_ENV: "development" });
    const { siteUrl } = await load();
    expect(siteUrl()).toBe("http://localhost:3000");
  });

  it("logs loudly, once, when a production runtime has to use the localhost fallback", async () => {
    setEnv({ NODE_ENV: "production" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { siteUrl } = await load();
    expect(siteUrl()).toBe("http://localhost:3000");
    expect(siteUrl()).toBe("http://localhost:3000");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignores an unparseable value instead of throwing (metadataBase is build-time)", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "http://", NODE_ENV: "development" });
    const { siteUrl } = await load();
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});

describe("trustedOriginFor (KN-125)", () => {
  it("accepts the request host when this deployment answers on it", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://kivo.app", NODE_ENV: "production" });
    const { trustedOriginFor } = await load();
    expect(trustedOriginFor("kivo.app", "https")).toBe("https://kivo.app");
  });

  it("accepts the per-deployment Vercel URL, so preview sign-in links still work", async () => {
    setEnv({
      NEXT_PUBLIC_APP_URL: "https://kivo.app",
      VERCEL_URL: "kivo-git-branch-team.vercel.app",
      NODE_ENV: "production",
    });
    const { trustedOriginFor } = await load();
    expect(trustedOriginFor("kivo-git-branch-team.vercel.app", "https")).toBe("https://kivo-git-branch-team.vercel.app");
  });

  // The actual attack: an attacker-supplied x-forwarded-host becoming the URL
  // embedded in mail sent from KIVO's domain.
  it("refuses a host this deployment does not answer on", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://kivo.app", NODE_ENV: "production" });
    const { trustedOriginFor } = await load();
    expect(trustedOriginFor("evil.example.com", "https")).toBe("https://kivo.app");
    expect(trustedOriginFor("kivo.app.evil.example.com", "https")).toBe("https://kivo.app");
  });

  it("uses only the first entry of a comma-joined forwarded header", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://kivo.app", NODE_ENV: "production" });
    const { trustedOriginFor } = await load();
    expect(trustedOriginFor("kivo.app, evil.example.com", "https")).toBe("https://kivo.app");
    expect(trustedOriginFor("evil.example.com, kivo.app", "https")).toBe("https://kivo.app");
  });

  it("does not trust localhost in production", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://kivo.app", NODE_ENV: "production" });
    const { trustedOriginFor } = await load();
    expect(trustedOriginFor("localhost:3000", null)).toBe("https://kivo.app");
  });

  it("does trust localhost in development, so `next dev` still signs people in", async () => {
    setEnv({ NODE_ENV: "development" });
    const { trustedOriginFor } = await load();
    expect(trustedOriginFor("localhost:3000", null)).toBe("http://localhost:3000");
  });

  it("falls back to the canonical site URL when there is no host at all", async () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://kivo.app", NODE_ENV: "production" });
    const { trustedOriginFor } = await load();
    expect(trustedOriginFor(null, null)).toBe("https://kivo.app");
  });
});
