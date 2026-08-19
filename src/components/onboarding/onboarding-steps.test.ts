import { describe, expect, it } from "vitest";
import { onboardingSteps } from "./onboarding-flow";

/**
 * Onboarding used to open by asking for a username. Sign-up now collects the
 * handle, the full name and the country BEFORE verification, so for anybody
 * arriving through /sign-up that question is already answered and asking it
 * again is the dead step this rework exists to delete.
 *
 * It is deleted *conditionally* rather than outright, and these tests pin both
 * halves of that: gone for the normal case, still there for the two states
 * where a profile genuinely holds a machine-generated handle (an account made
 * before the sign-up form collected one, and a sign-up whose handle lost a race
 * to another signup between the form checking it and the email being verified —
 * see resolveViewerProfile in src/lib/profile.ts).
 */
describe("onboardingSteps", () => {
  it("never asks a new signee for a username — they gave one before verifying", () => {
    const steps = onboardingSteps({ needsUsername: false, hasTeams: true });

    expect(steps).toEqual(["intro", "team", "clubs", "alerts"]);
    expect(steps).not.toContain("username");
  });

  it("still asks when the profile is carrying a generated handle", () => {
    expect(onboardingSteps({ needsUsername: true, hasTeams: true })).toEqual([
      "intro",
      "username",
      "team",
      "clubs",
      "alerts",
    ]);
  });

  it("drops the club steps when no football has been synced, rather than showing an empty picker", () => {
    expect(onboardingSteps({ needsUsername: false, hasTeams: false })).toEqual(["intro", "alerts"]);
    expect(onboardingSteps({ needsUsername: true, hasTeams: false })).toEqual(["intro", "username", "alerts"]);
  });

  it("always has something after the intro for its Get started button to reach", () => {
    for (const needsUsername of [true, false]) {
      for (const hasTeams of [true, false]) {
        const steps = onboardingSteps({ needsUsername, hasTeams });
        expect(steps[0]).toBe("intro");
        expect(steps[1]).toBeDefined();
        // Every step is distinct, so the dots count what the user actually sees.
        expect(new Set(steps).size).toBe(steps.length);
      }
    }
  });
});
