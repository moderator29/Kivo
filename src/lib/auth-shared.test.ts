import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  checkPassword,
  describePasswordProblem,
  isPasswordAcceptable,
  normalizeEmail,
  normalizeUsername,
} from "./auth-shared";

/**
 * These validators are the only copy of KIVO's password and handle rules. The
 * sign-up form imports them to tell the user what is required, and the Server
 * Action imports the same functions to decide whether to create the account —
 * so a bug here is not a display bug, it is the rule itself being wrong.
 */

describe("normalizeUsername", () => {
  it("folds a typed handle into exactly what will be stored", () => {
    // The reported bug: "Puffnutz_" was reported available (correctly —
    // "puffnutz_" was free) while the input's own pattern then blocked submit.
    // Folding on the way in is what removes that contradiction.
    expect(normalizeUsername("Puffnutz_")).toBe("puffnutz_");
    expect(normalizeUsername("  LagosUltra  ")).toBe("lagosultra");
  });

  it("produces something the stored-username pattern accepts", () => {
    expect(USERNAME_PATTERN.test(normalizeUsername("Puffnutz_"))).toBe(true);
  });

  it("does not invent validity — a handle with a space is still rejected", () => {
    expect(USERNAME_PATTERN.test(normalizeUsername("lagos ultra"))).toBe(false);
    expect(USERNAME_PATTERN.test(normalizeUsername("ab"))).toBe(false);
    expect(USERNAME_PATTERN.test(normalizeUsername("a".repeat(25)))).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, so one mailbox is one account", () => {
    expect(normalizeEmail("  Founder@KIVO.app ")).toBe("founder@kivo.app");
  });
});

describe("checkPassword", () => {
  it("reports each rule separately so the form can tick them off live", () => {
    expect(checkPassword("short1")).toMatchObject({ longEnough: false, hasLetter: true, hasNumber: true });
    expect(checkPassword("aaaaaaaaaaaa")).toMatchObject({ longEnough: true, hasLetter: true, hasNumber: false });
    expect(checkPassword("123456789012")).toMatchObject({ longEnough: true, hasLetter: false, hasNumber: true });
  });

  it("measures the bcrypt ceiling in bytes, not characters", () => {
    // Bcrypt truncates at 72 BYTES. A password of 72 multi-byte characters is
    // well past that, and silently ignoring the tail is worse than refusing it.
    expect(checkPassword("é".repeat(PASSWORD_MAX_BYTES)).withinByteLimit).toBe(false);
    expect(checkPassword("a".repeat(PASSWORD_MAX_BYTES)).withinByteLimit).toBe(true);
  });
});

describe("isPasswordAcceptable", () => {
  it("accepts a password that meets every stated rule", () => {
    expect(isPasswordAcceptable("kivofootball1")).toBe(true);
  });

  it("rejects one that is exactly one character short of the stated minimum", () => {
    expect(isPasswordAcceptable(`a1${"b".repeat(PASSWORD_MIN_LENGTH - 3)}`)).toBe(false);
  });

  it("rejects length alone", () => {
    expect(isPasswordAcceptable("aaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("describePasswordProblem", () => {
  it("says nothing when there is no problem", () => {
    expect(describePasswordProblem("kivofootball1")).toBeNull();
  });

  it("names the length ceiling separately, because it is the one rule a user cannot guess", () => {
    expect(describePasswordProblem("a1".repeat(60))).toMatch(/at most 72/i);
  });

  it("gives one sentence for the strength rules rather than naming which one failed", () => {
    expect(describePasswordProblem("aaaaaaaaaaaa")).toMatch(/at least 10 characters, including a letter and a number/i);
  });
});
