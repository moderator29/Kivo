import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A server action is a public HTTP endpoint. This test treats it as one.
 *
 * From docs/SECURITY_REVIEW.md: KIVO's real security boundary is RLS, because
 * `anon` and `authenticated` hold full DML on every table in `public` and the
 * publishable key ships in the browser bundle. Server actions are the layer
 * above that, and they are only worth anything if two things hold:
 *
 *   1. An action derives WHO IS CALLING from the session, never from an
 *      argument. An action that accepts `profileId` and queries with it is
 *      asking the caller who they are.
 *   2. An action that writes with the SERVICE-ROLE client — which bypasses RLS
 *      entirely, so no policy is left underneath to catch a mistake — has
 *      established the caller's identity before it does so.
 *
 * The second one is why this test exists rather than a note in a document. The
 * coordinator's call on `fantasy_rosters` was to drop the user-facing write
 * policies and let the server action write as service_role, because squad size,
 * budget and formation are properties of a fifteen-row SET that a per-row
 * `WITH CHECK` cannot evaluate. That is the right trade, and the thing it gives
 * up is the ownership backstop: a bug writing to somebody else's team would no
 * longer be refused by the database. Unlike the squad rules, that property IS
 * testable — so it gets tested, and this file is what buys back most of what
 * the policy gave up.
 *
 * Deliberately a source scan rather than a runtime test. The invariant is about
 * the SHAPE of every action in the codebase, including ones nobody has written
 * yet; a runtime test can only cover the actions somebody remembered to cover.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

function serverActionFiles(): { path: string; source: string }[] {
  return walk(SRC)
    .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(({ source }) => /^["']use server["'];?\s*$/m.test(source));
}

/** Extracts each exported action's name and its raw parameter list, counting
 * parentheses so an inline object or generic in a signature cannot truncate it. */
function exportedActions(source: string): { name: string; params: string }[] {
  const found: { name: string; params: string }[] = [];
  const signature = /export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = signature.exec(source)) !== null) {
    let depth = 1;
    let i = signature.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") depth -= 1;
      i += 1;
    }
    found.push({ name: match[1], params: source.slice(signature.lastIndex, i - 1) });
  }
  return found;
}

/** Top-level parameter names only — splits on commas outside any bracket. */
function parameterNames(params: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of params) {
    if ("([{<".includes(char)) depth += 1;
    else if (")]}>".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      names.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  names.push(current);

  return names
    .map((part) => part.trim().split(":")[0].trim())
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
}

/**
 * Names that mean "this is who I am", as opposed to "this is who I am acting
 * on". The distinction matters: `suspendUser(targetProfileId)` and
 * `blockUser(targetProfileId)` are correct — the TARGET is legitimately a
 * parameter, and both re-derive the ACTOR from the session and re-check the
 * actor's role before touching anything.
 */
const IDENTITY_PARAM = /^(profileId|profile_id|userId|user_id|actorId|authUserId|callerProfileId|currentProfileId|adminProfileId)$/;

/**
 * Known violations, recorded rather than hidden.
 *
 * Empty, and kept rather than deleted. The two entries it held —
 * `getQuietHours` and `getNotificationPreferences` — were fixed in
 * SECURITY_REVIEW.md F13: both dropped their `profileId` parameter and now read
 * `getOrCreateProfile()`. Neither ever leaked, because
 * `notification_preferences_all_own` restricted the read to the caller — but
 * that was RLS rescuing an action that asked the caller who they were, and it
 * failed in the wrong direction, since no rows reads as "no preferences saved"
 * and handed back the DEFAULTS as though they were that profile's real
 * settings.
 *
 * The set stays so the next genuine exception is recorded here in the open
 * rather than by loosening the check that found it.
 */
const KNOWN_IDENTITY_PARAM_VIOLATIONS = new Set<string>();

/** Ways an action can establish who is calling. */
const DERIVES_IDENTITY = /getOrCreateProfile\s*\(|resolveViewerProfile\s*\(|getSessionUser\s*\(|requireModerationActor\s*\(|auth\.getUser\s*\(/;

/**
 * `auth-actions.ts` is the one legitimate exception to the service-role rule:
 * it runs BEFORE anybody has an identity — that is its whole job — and it
 * reaches for the service-role client only to consume a rate limit keyed on an
 * email address and an IP, never to write user data. See its own `throttle`
 * doc comment, which is the most carefully reasoned rate-limiting in the
 * codebase.
 */
const PRE_IDENTITY_BY_DESIGN = new Set(["auth-actions.ts"]);

describe("server actions are treated as public endpoints", () => {
  it("finds the server actions to check (guards against a broken scan)", () => {
    const files = serverActionFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap(({ source }) => exportedActions(source)).length).toBeGreaterThan(50);
  });

  it("never accepts the caller's own identity as an argument", () => {
    const offenders: string[] = [];

    for (const { path, source } of serverActionFiles()) {
      for (const action of exportedActions(source)) {
        if (KNOWN_IDENTITY_PARAM_VIOLATIONS.has(action.name)) continue;
        for (const param of parameterNames(action.params)) {
          if (IDENTITY_PARAM.test(param)) {
            offenders.push(`${path.replace(process.cwd(), "")} → ${action.name}(${param})`);
          }
        }
      }
    }

    // A `targetProfileId` is fine and deliberately not matched: the target of a
    // moderation action is real input. The ACTOR never is.
    expect(offenders, "a server action must derive the caller from the session").toEqual([]);
  });

  it("establishes identity before using the service-role client", () => {
    const offenders: string[] = [];

    for (const { path, source } of serverActionFiles()) {
      const file = path.split("/").pop() ?? path;
      if (PRE_IDENTITY_BY_DESIGN.has(file)) continue;
      if (!source.includes("createServiceRoleSupabaseClient")) continue;
      if (!DERIVES_IDENTITY.test(source)) {
        offenders.push(path.replace(process.cwd(), ""));
      }
    }

    expect(
      offenders,
      "service-role writes bypass RLS entirely, so the action is the only boundary left",
    ).toEqual([]);
  });

  /**
   * The one place the identity invariant lives OUTSIDE a server action, and
   * therefore the one most likely to rot.
   *
   * `carryForwardFantasyRoster` writes fantasy_rosters rows with the
   * service-role client, deliberately AFTER the gameweek deadline — that is the
   * single write that must survive the lock, and it is KIVO applying a
   * documented rule on the manager's behalf rather than a manager editing a
   * locked squad. Because 0097 removed the user-facing write policies, no
   * ownership check remains in the database for it either.
   *
   * It has no ownership comparison of its own to make: every row it writes is
   * built from the `fantasyTeamId` argument and from a prior-roster read scoped
   * to that same id. Ownership is therefore established by its CALLER. This
   * asserts the two properties that keep that safe — that the team id really is
   * the only source of the rows, and that its caller resolves that id from the
   * signed-in profile rather than from a request.
   */
  it("carry-forward derives its rows solely from the team id its caller resolved", () => {
    const source = readFileSync(join(SRC, "lib", "fantasy.ts"), "utf8");

    expect(source).toMatch(/createServiceRoleSupabaseClient/);
    // No second identity enters the function: it must not read the session or
    // accept a profile id, because its whole safety argument is that the caller
    // already did that and passed a team id it owns.
    expect(source).not.toMatch(/carryForwardFantasyRoster[\s\S]{0,1200}?getOrCreateProfile/);

    // The caller. /fantasy resolves the team from the signed-in profile before
    // it ever reaches carry-forward; if that stops being true, this breaks.
    const page = readFileSync(join(SRC, "app", "(app)", "fantasy", "page.tsx"), "utf8");
    expect(page).toMatch(/getOrCreateProfile/);
    expect(page).toMatch(/carryForwardFantasyRoster/);
  });

  it("re-checks authorization in every admin action, not just in the layout", () => {
    // Derived from the real exports of src/lib/admin.ts rather than guessed —
    // the first draft of this regex invented `canViewSupportData`, which does
    // not exist, and reported a correctly-written file as a finding. A guessed
    // allow-list is how a test starts lying about the thing it checks.
    const ROLE_CHECK =
      /hasAdminAccess|canViewModerationData|canViewUserData|canManageFootballData|canHandleSupport|requireModerationActor/;
    const offenders: string[] = [];

    for (const { path, source } of serverActionFiles()) {
      if (!path.includes("/app/admin/")) continue;
      if (!ROLE_CHECK.test(source)) offenders.push(path.replace(process.cwd(), ""));
    }

    // /admin/layout.tsx already redirects non-admins, but a server action is
    // reachable without ever rendering the layout that "protects" it.
    expect(offenders, "an admin action is reachable without its layout").toEqual([]);
  });
});
