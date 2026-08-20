import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * F1, enforced instead of remembered (RECOMMENDATIONS.md, "Frontend sweep").
 *
 * The single largest quality problem on the deployed product was KIVO's own
 * plumbing rendered into it: "Score and status synced 5h", "Sync time
 * unknown", "Provider requests remaining today". Every one of those sentences
 * was true, which is why they survived review — but "synced" is a fact about
 * a job queue, not about football, and a product that keeps naming its own
 * pipeline reads as a broken one.
 *
 * F1 shipped a grep as "a cheap regression check, until something better
 * exists". This is the better thing, and the reason the grep was not enough is
 * the finding worth keeping: run over `src/app/(app)` and `src/components`,
 * that grep returned about seventy hits, of which sixty-eight were engineering
 * comments explaining *why* the vocabulary was removed. Nobody reads a check
 * that is 97% false positives, and in fact nobody did — three real leaks were
 * sitting inside that noise on the day this test was written, one of them a
 * whole sentence on the player comparison page.
 *
 * So this does not grep. It parses each file and looks only at what a reader
 * can actually see: JSX text, and string/template literals that read as prose.
 *
 * ## The two scoping decisions, and why
 *
 * **Prose only, not identifiers.** A single-token string is code wearing
 * quotes — an import path, a Postgres column, a discriminated-union member —
 * and none of it reaches a fan. `.eq("provider", name)` is a correct query and
 * flagging it teaches the next author to distrust the test. Naming is still a
 * real concern (it is why `getLastSyncedAt` became `getLastUpdatedAt`), but it
 * is a review concern, not something a scanner can judge: `syncEdges` in
 * `section-tabs.tsx` synchronises two scroll edges and has nothing to do with
 * football data.
 *
 * **`loaded` and `pulled` are not on the list**, though F1's prose names them.
 * "Couldn't be loaded" and "Loading…" are ordinary product English in every
 * app anyone has ever used. The words below are different: on a football page
 * none of them has a non-internal reading, so a hit is always a leak and never
 * a judgement call. A test that asks for a judgement gets an exception instead
 * of a fix.
 *
 * Admin is exempt by design and by F2 — an operator is owed precise technical
 * language, and `src/components/admin/**` should keep saying "quota".
 */
const BANNED =
  /\b(sync|syncs|synced|syncing|quota|quotas|ingest|ingests|ingested|scrape|scrapes|scraped|provider|providers|endpoint|endpoints)\b/i;

/** Guest-viewable product surfaces. `src/app/admin` is absent on purpose; so is
 * `src/lib`, where this vocabulary is the correct and precise vocabulary. */
const SURFACES = ["src/app/(app)", "src/components"];

/** Shares a name with a rendered component but is read by engineers only. */
const isTestFile = (name: string) => /\.test\.tsx?$/.test(name);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "admin") sourceFiles(path, acc);
    } else if (/\.tsx?$/.test(entry) && !isTestFile(entry)) {
      acc.push(path);
    }
  }
  return acc;
}

/**
 * A string literal counts as prose when it contains a space between two word
 * characters — "No matches yet" does, `"nothing-recorded"` and
 * `"@/lib/football/auto-sync"` do not. Deliberately crude: the alternative is
 * tracking which literals reach a JSX child or a `label`/`title`/`description`
 * prop, which is a type-checker's job and would miss a string that travels
 * through a helper on the way to the screen.
 */
function readsAsProse(text: string): boolean {
  return /\w\s+\w/.test(text);
}

function leaksIn(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isJsxText(node)) {
      text = node.text;
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    }

    if (text !== null && readsAsProse(text) && BANNED.test(text)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const word = BANNED.exec(text)?.[0] ?? "";
      found.push(
        `${relative(process.cwd(), path).split(sep).join("/")}:${line + 1} — "${word}" in ${JSON.stringify(
          text.trim().replace(/\s+/g, " ").slice(0, 90),
        )}`,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

describe("product vocabulary", () => {
  it("never renders KIVO's own plumbing to a fan", () => {
    const leaks = SURFACES.flatMap((surface) => sourceFiles(join(process.cwd(), surface))).flatMap(leaksIn);

    expect(
      leaks,
      "State the same true fact in the reader's language: \"Statistics aren't available for this match yet\", " +
        "never \"not synced yet\". If the sentence is for an operator, it belongs under src/app/admin.",
    ).toEqual([]);
  });

  it("scans a real number of files, so a broken walk cannot pass silently", () => {
    const files = SURFACES.flatMap((surface) => sourceFiles(join(process.cwd(), surface)));
    expect(files.length).toBeGreaterThan(200);
  });

  it("catches a leak when there is one", () => {
    // The test's own worked example, so the check is verified rather than
    // trusted: this is close to the exact sentence that was live on the player
    // comparison page until 2026-08-20.
    expect(readsAsProse("Sync coverage is admin-triggered and partial.")).toBe(true);
    expect(BANNED.test("Sync coverage is admin-triggered and partial.")).toBe(true);
    // ...and does not fire on the code-shaped strings that surround it.
    expect(readsAsProse("@/lib/football/auto-sync")).toBe(false);
    expect(readsAsProse("nothing-recorded")).toBe(false);
  });
});
