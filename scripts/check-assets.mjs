#!/usr/bin/env node
/**
 * KN-137. `ICON_MANIFEST.md` documents 155 icons as a deliberate design
 * library (RECOMMENDATIONS item 88's chosen resolution) and, until this, nothing
 * enforced the mapping. A renamed or deleted asset broke a page at runtime with
 * no build-time signal at all — `next build` does not resolve string paths into
 * `public/`, so `/assets/icons/navigation/teams.webp` is just a string until a
 * user's browser asks for it and gets a 404.
 *
 * Three checks, and the third is the one that actually prevents a broken page:
 *
 *   1. Every icon the manifest documents exists on disk.
 *   2. Every icon on disk is documented. Catches an asset added without a row,
 *      which is how a "deliberate library" quietly becomes a junk drawer.
 *   3. Every `/assets/...` and `/brand/...` path written as a string literal in
 *      `src/` resolves to a real file. This is the runtime-breakage check;
 *      1 and 2 are bookkeeping.
 *
 * Exits non-zero with a specific list, so CI fails with the filename rather
 * than "assets check failed".
 */
import { readFileSync, existsSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function walk(dir, predicate, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, found);
    else if (predicate(full)) found.push(full);
  }
  return found;
}

const problems = [];

/* --- 1 & 2: manifest <-> public/assets/icons ---------------------------- */

const manifest = readFileSync(join(root, "ICON_MANIFEST.md"), "utf8");
// Rows reference icons as `category/name.webp` inside backticks.
const documented = new Set(
  [...manifest.matchAll(/`([a-z0-9-]+\/[a-z0-9-]+\.webp)`/g)].map((match) => match[1]),
);

const iconsDir = join(root, "public/assets/icons");
const onDisk = new Set(
  walk(iconsDir, (file) => file.endsWith(".webp")).map((file) =>
    relative(iconsDir, file).split("\\").join("/"),
  ),
);

for (const icon of documented) {
  if (!onDisk.has(icon)) {
    problems.push(`ICON_MANIFEST.md documents public/assets/icons/${icon}, which does not exist.`);
  }
}
for (const icon of onDisk) {
  if (!documented.has(icon)) {
    problems.push(`public/assets/icons/${icon} exists but has no row in ICON_MANIFEST.md.`);
  }
}

/* --- 3: every asset path written in src/ resolves ----------------------- */

const sourceFiles = walk(
  join(root, "src"),
  (file) => file.endsWith(".ts") || file.endsWith(".tsx"),
);

const PATH_PATTERN = /["'](\/(?:assets|brand)\/[A-Za-z0-9/_.-]+\.[a-z0-9]+)["']/g;

for (const file of sourceFiles) {
  const contents = readFileSync(file, "utf8");
  for (const match of contents.matchAll(PATH_PATTERN)) {
    const assetPath = match[1];
    if (!existsSync(join(root, "public", assetPath))) {
      problems.push(`${relative(root, file)} references ${assetPath}, which does not exist in public/.`);
    }
  }
}

/* ----------------------------------------------------------------------- */

if (problems.length > 0) {
  console.error(`Asset check failed (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(
  `Assets OK: ${documented.size} icons documented and present, ` +
    `${sourceFiles.length} source files checked for dangling asset paths.`,
);
