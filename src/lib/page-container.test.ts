import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  containerSignature,
  importedLocalModules,
  isPageContainer,
  pageContainerSignatures,
} from "./page-container";

describe("containerSignature", () => {
  it("keeps only the classes that place content", () => {
    expect(containerSignature("mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8")).toBe(
      "gap-6 lg:px-8 max-w-2xl px-4 py-8",
    );
  });

  it("ignores the order the classes were written in", () => {
    expect(containerSignature("gap-6 px-4 max-w-2xl")).toBe(containerSignature("max-w-2xl gap-6 px-4"));
  });

  it("ignores classes that cannot move anything", () => {
    expect(containerSignature("kivo-page text-center font-semibold text-foreground")).toBe("kivo-page");
  });

  it("keeps a container modifier, which changes the width", () => {
    expect(containerSignature("kivo-page kivo-page--narrow")).toBe("kivo-page kivo-page--narrow");
  });

  // The defect this whole module exists for: `.kivo-page` is 24px of top
  // padding and a 20px gap on a phone, the ad-hoc column is 32px and 24px.
  it("tells the two containers KIVO actually uses apart", () => {
    expect(containerSignature("kivo-page")).not.toBe(
      containerSignature("mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8"),
    );
  });
});

describe("isPageContainer", () => {
  it.each([
    "kivo-page",
    "kivo-page kivo-page--narrow",
    "mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8",
  ])("recognises %s as a page container", (className) => {
    expect(isPageContainer(className)).toBe(true);
  });

  it.each([
    "kivo-glass flex flex-col gap-3 rounded-2xl p-4",
    "flex items-center gap-2",
    "mx-auto h-4 w-4",
  ])("does not mistake %s for a page container", (className) => {
    expect(isPageContainer(className)).toBe(false);
  });
});

describe("pageContainerSignatures", () => {
  it("finds every container a file can render, not just the first", () => {
    const source = `
      if (!profile) return <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center" />;
      return <div className="kivo-page">{children}</div>;
    `;
    expect(pageContainerSignatures(source)).toEqual(
      expect.arrayContaining(["kivo-page", "gap-3 max-w-2xl px-6 py-24"]),
    );
  });

  it("reads a container written through cn()", () => {
    expect(pageContainerSignatures('<div className={cn("kivo-page", className)} />')).toEqual(["kivo-page"]);
  });

  it("returns nothing for a file that delegates its container elsewhere", () => {
    expect(pageContainerSignatures('return <EntityListPage title="Teams">{list}</EntityListPage>;')).toEqual([]);
  });
});

describe("importedLocalModules", () => {
  it("lists the KIVO modules a page could get its container from", () => {
    const source = `
      import type { Metadata } from "next";
      import { EntityListPage } from "@/components/ui/entity-list-page";
      import { FantasyBuilder } from "./fantasy-builder";
      import { createServerSupabaseClient } from "@/lib/supabase/server";
    `;
    expect(importedLocalModules(source)).toEqual([
      "@/components/ui/entity-list-page",
      "./fantasy-builder",
      "@/lib/supabase/server",
    ]);
  });

  it("ignores packages, which cannot hold a KIVO container", () => {
    expect(importedLocalModules('import { redirect } from "next/navigation";')).toEqual([]);
  });

  it("does not repeat a module imported twice", () => {
    const source = 'import { A } from "./x";\nimport type { B } from "./x";';
    expect(importedLocalModules(source)).toEqual(["./x"]);
  });
});

/* -------------------------------------------------------------------------
   The rule itself, applied to the real app directory.

   Every route-level `loading.tsx` must render into a container its own page
   actually renders into — its own, or one belonging to a layout shell that
   page delegates to. This is the check that would have caught /settings,
   /social and /u/<handle> drifting onto the older ad-hoc column while their
   pages moved to `.kivo-page`, and it is what stops the next one.
   ------------------------------------------------------------------------- */

const APP_DIR = resolve(__dirname, "../app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "loading.tsx") out.push(full);
  }
  return out;
}

function resolveModule(importPath: string, fromDir: string): string {
  if (importPath.startsWith("@/")) return resolve(__dirname, "..", `${importPath.slice(2)}.tsx`);
  return resolve(fromDir, `${importPath}.tsx`);
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Signatures the page renders directly, plus those of every KIVO module it
 * imports — because the container very often lives one level down, in the
 * shell or the single big component the page hands its content to. */
function allowedSignatures(pageSource: string, pageDir: string): string[] {
  const signatures = new Set(pageContainerSignatures(pageSource));
  for (const importPath of importedLocalModules(pageSource)) {
    const moduleSource = read(resolveModule(importPath, pageDir));
    if (moduleSource) for (const s of pageContainerSignatures(moduleSource)) signatures.add(s);
  }
  return [...signatures];
}

const loadingFiles = walk(APP_DIR);

describe("every loading.tsx matches the geometry of the page it stands in for", () => {
  it("found the app directory to check", () => {
    expect(loadingFiles.length).toBeGreaterThan(20);
  });

  it.each(loadingFiles.map((file) => [file.slice(APP_DIR.length) || file, file]))(
    "%s",
    (_label, file) => {
      const pageSource = read(join(dirname(file), "page.tsx"));

      // A loading.tsx with no sibling page is a shared fallback for a whole
      // subtree (src/app/(app)/loading.tsx) and has no single page to match.
      if (pageSource === null) return;

      const skeletonSignatures = pageContainerSignatures(read(file) ?? "");

      // A page that renders only a full-bleed state (<ComingSoon>) offers no
      // container to compare against.
      const allowed = allowedSignatures(pageSource, dirname(file));
      if (allowed.length === 0 || skeletonSignatures.length === 0) return;

      expect(
        skeletonSignatures.some((signature) => allowed.includes(signature)),
        `${file.slice(APP_DIR.length)} renders into [${skeletonSignatures.join(" | ")}] but its page renders into [${allowed.join(" | ")}]. ` +
          "A skeleton in the wrong container makes the page jump when content lands.",
      ).toBe(true);
    },
  );
});
