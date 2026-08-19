#!/usr/bin/env node
/**
 * Builds the JPEG derivatives of KIVO's ten profile backgrounds that the
 * share-card image route (`/api/share-card`) draws behind every card.
 *
 * Why a derivative exists at all: `next/og`'s bundled rasteriser (resvg) can
 * decode PNG and JPEG `<img>` sources and **cannot decode WEBP** — a WEBP data
 * URI throws "u2 is not iterable" inside the renderer, which was hit for real
 * on the match card and resolved the same way (see the sibling comment in
 * `src/app/api/matches/[id]/share-card/route.tsx`). The originals under
 * `public/assets/kivo/backgrounds/` stay WEBP and stay the only thing the
 * browser ever loads; these derivatives are read by the image route alone.
 *
 * Why JPEG rather than the match card's PNG: these are photographic AI
 * renders with no transparency, and ten lossless 1080x1080 PNGs would add
 * ~15MB to the repo for pixels that sit behind a scrim. Quality 88 JPEG is
 * visually indistinguishable at share size and roughly a tenth of that.
 *
 * The source art is 512x420, so squaring it to the card canvas is a centre
 * cover-crop plus an upscale. That is a real quality cost and the reason the
 * cards never put small text directly on bare artwork — every card lays its
 * content on an opaque panel over a darkening scrim.
 *
 * Run: `node scripts/generate-share-card-backgrounds.mjs`
 * Requires `sharp`, which ships with Next as an image-optimisation dependency
 * and is therefore already installed; it is deliberately NOT a declared
 * dependency of the app, because no application code imports it — this script
 * is run by hand when the background set changes, and its output is committed.
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error("sharp is not resolvable. It normally arrives with next; run `npm install` first.");
  process.exit(1);
}

// Kept in sync by hand with KIVO_BACKGROUND_IDS in src/lib/kivo-assets.ts —
// the same duplicated-literal trade that file already documents for the
// database check constraints. The loop below fails loudly on a missing
// source, so an id added there and forgotten here surfaces immediately.
const BACKGROUND_IDS = [
  "kivo-bg-01",
  "kivo-bg-02",
  "kivo-bg-04",
  "kivo-bg-05",
  "kivo-bg-07",
  "kivo-bg-08",
  "kivo-bg-09",
  "kivo-bg-10",
  "kivo-bg-11",
  "kivo-bg-12",
];

const SIZE = 1080;
const sourceDir = join(root, "public/assets/kivo/backgrounds");
const outDir = join(root, "public/assets/kivo/share-cards/backgrounds");

mkdirSync(outDir, { recursive: true });

let failed = false;
for (const id of BACKGROUND_IDS) {
  const source = join(sourceDir, `${id}.webp`);
  if (!existsSync(source)) {
    console.error(`missing source: ${source}`);
    failed = true;
    continue;
  }
  const out = join(outDir, `${id}.jpg`);
  await sharp(source)
    .resize(SIZE, SIZE, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toFile(out);
  console.log(`wrote ${out}`);
}

if (failed) process.exit(1);
