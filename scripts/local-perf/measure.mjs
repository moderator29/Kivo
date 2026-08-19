#!/usr/bin/env node
/**
 * Core Web Vitals for KIVO's public routes, on the device the product is for.
 *
 * Run against a PRODUCTION build (`next build && next start`) — dev-server
 * numbers measure Turbopack, not the product. See docs/PERFORMANCE.md for the
 * conditions this encodes and for the baseline it produced.
 *
 * Two harness details that are not obvious and cost real time:
 *
 *  - Browse `http://localhost:<port>`, never `http://127.0.0.1:<port>`. The two
 *    are different origins; Next answers 403 for every `_next/static` chunk
 *    across them, hydration silently never completes, and the page renders as
 *    though every animated element were invisible.
 *  - `waitUntil: "networkidle"` never fires against a dev server because of the
 *    HMR socket. `domcontentloaded` plus an explicit selector does.
 *
 * Run node with the proxy environment cleared, or Chromium routes localhost
 * through the outbound agent proxy:
 *
 *   env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy NO_PROXY='*' \
 *     node scripts/local-perf/measure.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const RUNS = Number(process.env.RUNS ?? 3);
const SETTLE = Number(process.env.SETTLE ?? 7000);
const CHROME = process.env.CHROME_PATH;

/** Chrome DevTools "Slow 3G". The launch market is on a mobile network. */
const NETWORK = {
  offline: false,
  downloadThroughput: (400 * 1024) / 8,
  uploadThroughput: (400 * 1024) / 8,
  latency: 400,
};
/** Roughly a low-end Android against a developer machine. */
const CPU_RATE = 4;

/** Everything behind /(app) needs a session and a reachable database; these are
 * the routes a first-time visitor actually meets. */
const ROUTES = ["/", "/about", "/terms", "/privacy", "/support", "/sign-in", "/sign-up"];

const COLLECT = `
new Promise((resolve) => {
  const out = { lcp: 0, cls: 0, tbt: 0, fcp: 0, longTasks: 0, lcpEl: "" };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.startTime >= out.lcp) {
        out.lcp = e.startTime;
        out.lcpEl = e.element?.tagName ?? e.url ?? "?";
      }
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) { out.longTasks++; out.tbt += Math.max(0, e.duration - 50); }
  }).observe({ type: "longtask", buffered: true });
  setTimeout(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    if (fcp) out.fcp = fcp.startTime;
    resolve(out);
  }, ${SETTLE});
})`;

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

for (const route of ROUTES) {
  const samples = [];
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; Redmi Note 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", NETWORK);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });

    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("h1, main, [role='status']", { timeout: 60000 }).catch(() => {});
    samples.push(await page.evaluate(COLLECT));
    await ctx.close();
  }
  const median = (key) => {
    const values = samples.map((s) => s[key]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  console.log(
    `${route.padEnd(10)} FCP ${String(Math.round(median("fcp"))).padStart(5)}ms` +
      `  LCP ${String(Math.round(median("lcp"))).padStart(5)}ms` +
      `  TBT ${String(Math.round(median("tbt"))).padStart(5)}ms` +
      `  CLS ${median("cls").toFixed(4).padStart(7)}` +
      `  (LCP element ${samples[0].lcpEl || "none observed"})`,
  );
}

await browser.close();
