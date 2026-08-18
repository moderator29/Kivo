#!/usr/bin/env node
/**
 * KN-134. `@vercel/analytics` reports real user timing after the fact; nothing
 * failed a build when the shell grew. For a product whose stated market is
 * mobile-network-constrained, a size budget is the one guardrail that stops a
 * slow, invisible slide — every individual import looks cheap, and none of them
 * is ever the one that made the app slow.
 *
 * What is measured, and why these three numbers:
 *
 *   shell  `rootMainFiles` + polyfills from .next/build-manifest.json. This is
 *          the JavaScript EVERY route loads before it can do anything, so it is
 *          the number that decides how long the first screen takes on a slow
 *          connection. It is the budget that matters most.
 *   client every chunk under .next/static/chunks. Catches growth that lands on
 *          individual routes rather than the shell — a heavy dependency pulled
 *          into one page is still shipped to whoever visits that page.
 *   css    all built stylesheets. Render-blocking, so it belongs here too.
 *
 * Sizes are gzipped, because that is what actually crosses the network.
 *
 * Raising a budget is allowed and is meant to be a decision: change the number
 * here, in a commit, with a message saying what it bought. What this prevents
 * is the number changing without anyone noticing.
 *
 * Run after `next build`. Exits non-zero over budget.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const next = join(root, ".next");

/**
 * Budgets in KB (gzipped), set from the size measured on 2026-08-18 plus
 * deliberate headroom — tight enough to catch a regression, loose enough that a
 * normal feature does not trip it.
 *
 *   shell   166.8 KB measured  ->  185 KB budget
 *   client  524.8 KB measured  ->  640 KB budget
 *   css      17.1 KB measured  ->   30 KB budget
 *
 * These ratify the current numbers rather than endorse them, and one of them
 * deserves saying out loud: a 167 KB gzipped shell is high for a product built
 * for constrained mobile networks. It is mostly React 19 plus Next's App Router
 * runtime, which is a floor, but `motion` is in it too — and `motion` is in the
 * shell only because components in the app shell itself import it. Moving those
 * to CSS animations (the `FadeIn` precedent, RECOMMENDATIONS item 76) is the
 * one change that would move this number materially. Tracked, not done here.
 *
 * A budget that fails on the day it lands teaches people to ignore CI, so these
 * pass today. Raising one later is meant to be a decision: change the number
 * here, in its own commit, with a message saying what it bought.
 */
const BUDGETS_KB = {
  shell: 185,
  client: 640,
  css: 30,
};

function gzippedKb(files) {
  let total = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    total += gzipSync(readFileSync(file)).length;
  }
  return total / 1024;
}

function walk(dir, predicate, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, found);
    else if (predicate(full)) found.push(full);
  }
  return found;
}

if (!existsSync(join(next, "build-manifest.json"))) {
  console.error("No .next/build-manifest.json — run `npm run build` first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(next, "build-manifest.json"), "utf8"));
const shellFiles = [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])].map((file) =>
  join(next, file),
);

const measured = {
  shell: gzippedKb(shellFiles),
  client: gzippedKb(walk(join(next, "static/chunks"), (file) => file.endsWith(".js"))),
  css: gzippedKb(walk(join(next, "static"), (file) => file.endsWith(".css"))),
};

let failed = false;
for (const [name, budget] of Object.entries(BUDGETS_KB)) {
  const actual = measured[name];
  const pct = Math.round((actual / budget) * 100);
  const line = `${name.padEnd(7)} ${actual.toFixed(1).padStart(7)} KB / ${String(budget).padStart(4)} KB  (${pct}%)`;
  if (actual > budget) {
    failed = true;
    console.error(`OVER  ${line}`);
  } else {
    console.log(`ok    ${line}`);
  }
}

if (failed) {
  console.error(
    "\nOver budget. Either find what grew (a new dependency in a client component is the usual cause)\n" +
      "or raise the budget in scripts/check-bundle.mjs deliberately, in its own commit, saying what it bought.",
  );
  process.exit(1);
}
