#!/usr/bin/env node
/**
 * Total page weight per route, by resource type.
 *
 * Deliberately UNTHROTTLED, unlike scripts/local-perf/measure.mjs. At 400 kbit/s
 * the browser moves about 50 KB/s, so any fixed observation window over a
 * throttled connection measures the pipe rather than the page — the first
 * baseline run for docs/PERFORMANCE.md reported ~130 KB for every route because
 * that is simply what fits in six seconds. Total bytes and time-to-render are
 * different questions and have to be asked separately.
 *
 * Run against a production build, with the proxy environment cleared:
 *
 *   env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy NO_PROXY='*' \
 *     node scripts/local-perf/weigh.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH;
const ROUTES = ["/", "/about", "/terms", "/privacy", "/support", "/sign-in", "/sign-up"];

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

for (const route of ROUTES) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  const typeOf = new Map();
  const bytes = {};
  let total = 0;
  cdp.on("Network.responseReceived", (e) => typeOf.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => {
    total += e.encodedDataLength;
    const type = typeOf.get(e.requestId) ?? "Other";
    bytes[type] = (bytes[type] ?? 0) + e.encodedDataLength;
  });

  await page.goto(BASE + route, { waitUntil: "load", timeout: 120000 });
  // Enough for lazily-fetched images to settle; nothing here is time-limited.
  await page.waitForTimeout(2500);

  const kb = (n) => Math.round((n ?? 0) / 1024);
  console.log(
    `${route.padEnd(10)} total ${String(kb(total)).padStart(5)} KB` +
      `   img ${String(kb(bytes.Image)).padStart(5)}` +
      `   js ${String(kb(bytes.Script)).padStart(4)}` +
      `   font ${String(kb(bytes.Font)).padStart(3)}` +
      `   css ${String(kb(bytes.Stylesheet)).padStart(3)}` +
      `   doc ${String(kb(bytes.Document)).padStart(3)}` +
      `   other ${String(kb(bytes.Other)).padStart(3)}`,
  );
  await ctx.close();
}

await browser.close();
