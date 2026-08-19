import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KIVO_AVATAR_DESCRIPTIONS,
  KIVO_AVATAR_IDS,
  kivoAvatarDescriptionForSrc,
  kivoAvatarPath,
  resolveAvatarSrc,
} from "./kivo-assets";

/**
 * The avatar set is defined in three places that have no compiler link between
 * them: this module's id list, the exported files under `public/`, and the
 * `profiles_avatar_kivo_id_confirmed_clean` CHECK constraint in
 * supabase/migrations. They were out of sync — 18 designs commissioned, 5 in
 * the list, 5 on disk, 5 in the constraint — and the visible symptom was a
 * picker offering five options. Nothing in `tsc`, `eslint` or `next build`
 * could have caught that, so it is caught here.
 */

const root = join(import.meta.dirname, "../..");
const avatarsDir = join(root, "public/assets/kivo/avatars");

/** The id list from the newest migration that (re)defines the CHECK. */
function idsInLatestAvatarConstraint(): string[] {
  const migrationsDir = join(root, "supabase/migrations");
  const withConstraint = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) =>
      readFileSync(join(migrationsDir, f), "utf8").includes(
        "add constraint profiles_avatar_kivo_id_confirmed_clean",
      ),
    )
    .sort();
  const latest = withConstraint.at(-1);
  expect(latest, "no migration defines profiles_avatar_kivo_id_confirmed_clean").toBeDefined();

  const sql = readFileSync(join(migrationsDir, latest!), "utf8");
  // The last `add constraint ... check (...)` in the file is the live shape;
  // an earlier one in the same file would be the version it corrects.
  const body = sql.slice(sql.lastIndexOf("add constraint profiles_avatar_kivo_id_confirmed_clean"));
  return [...body.matchAll(/'(kivo-avatar-\d+)'/g)].map((m) => m[1]);
}

describe("KIVO avatar asset set", () => {
  it("ships all 18 commissioned designs", () => {
    expect(KIVO_AVATAR_IDS).toHaveLength(18);
  });

  it("has exactly one file on disk per id, and no undeclared files", () => {
    const onDisk = readdirSync(avatarsDir).filter((f) => f.endsWith(".webp")).sort();
    expect(onDisk).toEqual(KIVO_AVATAR_IDS.map((id) => `${id}.webp`).sort());
  });

  it("describes every avatar, with no description reused between two of them", () => {
    const descriptions = KIVO_AVATAR_IDS.map((id) => KIVO_AVATAR_DESCRIPTIONS[id]);
    expect(descriptions.every((d) => typeof d === "string" && d.length > 0)).toBe(true);
    expect(new Set(descriptions).size).toBe(KIVO_AVATAR_IDS.length);
  });

  it("never leaks an asset id into a description, since descriptions are user-facing labels", () => {
    for (const description of Object.values(KIVO_AVATAR_DESCRIPTIONS)) {
      expect(description).not.toMatch(/kivo-avatar|\d/);
    }
  });

  it("matches the database CHECK constraint exactly", () => {
    expect(idsInLatestAvatarConstraint().sort()).toEqual([...KIVO_AVATAR_IDS].sort());
  });

  it("round-trips a path back to its description", () => {
    for (const id of KIVO_AVATAR_IDS) {
      expect(kivoAvatarDescriptionForSrc(kivoAvatarPath(id))).toBe(KIVO_AVATAR_DESCRIPTIONS[id]);
    }
  });

  it("has no description for an upload, a legacy URL or nothing at all", () => {
    expect(kivoAvatarDescriptionForSrc(null)).toBeNull();
    expect(kivoAvatarDescriptionForSrc("https://example.supabase.co/storage/a/1.jpg")).toBeNull();
    expect(kivoAvatarDescriptionForSrc("/assets/kivo/avatars/kivo-avatar-99.webp")).toBeNull();
  });

  it("resolves each of the 18 as a real active avatar, not just the old five", () => {
    for (const id of KIVO_AVATAR_IDS) {
      expect(
        resolveAvatarSrc({
          avatar_type: "kivo",
          avatar_kivo_id: id,
          avatar_uploaded_url: null,
          avatar_url: null,
        }),
      ).toBe(`/assets/kivo/avatars/${id}.webp`);
    }
  });
});
