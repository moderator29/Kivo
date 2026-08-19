import { describe, expect, it, vi } from "vitest";
import {
  API_FOOTBALL_IMAGE_HOST,
  footballImageHosts,
  imgSrcOrigins,
  isValidImageHost,
  missingImageHostWarning,
  parseExtraImageHosts,
  remoteImagePatterns,
} from "./image-hosts";

describe("isValidImageHost", () => {
  it("accepts real hostnames", () => {
    expect(isValidImageHost("media.api-sports.io")).toBe(true);
    expect(isValidImageHost("r2.thesportsdb.com")).toBe(true);
    expect(isValidImageHost("a-b.c-d.example.co.uk")).toBe(true);
  });

  it("rejects anything that is not a bare hostname", () => {
    // A CSP directive is built from these, so a scheme, path, port or wildcard
    // slipping through would widen the policy rather than fail loudly.
    for (const bad of [
      "",
      "*",
      "*.example.com",
      "https://example.com",
      "example.com/path",
      "example.com:443",
      "localhost",
      "example",
      "-example.com",
      "example-.com",
      "exa mple.com",
      "'unsafe-inline'",
    ]) {
      expect(isValidImageHost(bad), bad).toBe(false);
    }
  });
});

describe("parseExtraImageHosts", () => {
  it("returns nothing for an unset or empty value", () => {
    expect(parseExtraImageHosts(undefined)).toEqual([]);
    expect(parseExtraImageHosts(null)).toEqual([]);
    expect(parseExtraImageHosts("")).toEqual([]);
    expect(parseExtraImageHosts("  ,  ,")).toEqual([]);
  });

  it("trims, lower-cases and de-duplicates", () => {
    expect(parseExtraImageHosts(" R2.Example.com , r2.example.com ,cdn.example.com")).toEqual([
      "r2.example.com",
      "cdn.example.com",
    ]);
  });

  it("drops invalid entries and reports them instead of throwing", () => {
    const onInvalid = vi.fn();
    expect(parseExtraImageHosts("good.example.com,*.evil.com", onInvalid)).toEqual(["good.example.com"]);
    expect(onInvalid).toHaveBeenCalledWith("*.evil.com");
  });
});

describe("footballImageHosts", () => {
  it("always includes the verified API-Football host", () => {
    expect(footballImageHosts()).toEqual([API_FOOTBALL_IMAGE_HOST]);
  });

  it("never lists the built-in host twice when it is also configured", () => {
    expect(footballImageHosts(`${API_FOOTBALL_IMAGE_HOST},cdn.example.com`)).toEqual([
      API_FOOTBALL_IMAGE_HOST,
      "cdn.example.com",
    ]);
  });
});

describe("the two host lists next.config.ts builds", () => {
  // The whole point of this module: remotePatterns and img-src drifted apart
  // once already and every provider image in the product was blocked by KIVO's
  // own CSP. This test fails if they are ever derived differently again.
  it("cover exactly the same provider hosts", () => {
    const extras = "cdn.example.com,r2.example.net";
    const patternHosts = remoteImagePatterns(extras).map((p) => p.hostname);
    const cspHosts = imgSrcOrigins({ extraHostsRaw: extras })
      .filter((o) => o.startsWith("https://"))
      .map((o) => new URL(o).hostname);

    for (const host of patternHosts) expect(cspHosts).toContain(host);
    expect(patternHosts).toEqual([API_FOOTBALL_IMAGE_HOST, "cdn.example.com", "r2.example.net"]);
  });

  it("keeps the legacy avatar host out of remotePatterns and in img-src", () => {
    expect(remoteImagePatterns().map((p) => p.hostname)).not.toContain("img.clerk.com");
    expect(imgSrcOrigins({})).toContain("https://img.clerk.com");
  });

  it("appends the Supabase origin to img-src only when configured", () => {
    expect(imgSrcOrigins({ supabaseOrigin: "https://abc.supabase.co" })).toContain("https://abc.supabase.co");
    expect(imgSrcOrigins({ supabaseOrigin: null }).some((o) => o.includes("supabase"))).toBe(false);
  });
});

describe("missingImageHostWarning", () => {
  it("says nothing for API-Football, whose host is built in", () => {
    expect(missingImageHostWarning({ provider: "api-football", extraHostsRaw: undefined })).toBeNull();
    expect(missingImageHostWarning({ provider: undefined, extraHostsRaw: undefined })).toBeNull();
  });

  it("warns for TheSportsDB with no host configured", () => {
    const warning = missingImageHostWarning({ provider: "thesportsdb", extraHostsRaw: undefined });
    expect(warning).toContain("FOOTBALL_IMAGE_HOSTS");
    // The two things a reader needs and would otherwise have to work out: that
    // the failure is silent, and that saving the value is not enough.
    expect(warning).toContain("silently");
    expect(warning).toContain("redeploy");
  });

  it("stays quiet once a host is configured", () => {
    expect(missingImageHostWarning({ provider: "thesportsdb", extraHostsRaw: "r2.example.com" })).toBeNull();
  });

  it("still warns when the configured value has no usable host in it", () => {
    // A value that parses to nothing is the same situation as an unset one, and
    // is the likelier mistake: `https://r2.example.com` looks set and is not.
    expect(missingImageHostWarning({ provider: "thesportsdb", extraHostsRaw: "https://r2.example.com" })).not.toBeNull();
    expect(missingImageHostWarning({ provider: "thesportsdb", extraHostsRaw: " , " })).not.toBeNull();
  });
});
