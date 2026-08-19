import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The password endpoints, tested for the properties that are invisible when
 * they break.
 *
 * Three of them matter more than the happy path:
 *
 *  1. **The server is the boundary.** Every rule the sign-up form shows has to
 *     be enforced again here, because the action is a public POST endpoint the
 *     moment it ships. The tests below submit payloads no browser would produce
 *     — an unticked agreement, a country that is not a country, mismatched
 *     passwords — and assert that Supabase is never reached.
 *  2. **A reset must not reveal whether an address has an account.** So
 *     `requestPasswordReset` has to answer identically for both, including when
 *     Supabase itself errors in a way that would give the game away.
 *  3. **Uniqueness is asked of the database, not assumed.** A taken handle must
 *     stop the signup before an auth user exists.
 */

type RpcAnswer = { data: boolean | null; error: unknown };

let usernameAnswer: RpcAnswer = { data: true, error: null };
let signUpError: unknown = null;
let signInError: unknown = null;
let resetError: unknown = null;

const signUp = vi.fn(async () => ({ data: { user: { id: "user-new" } }, error: signUpError }));
const signInWithPasswordCall = vi.fn(async () => ({ data: { user: { id: "user-new" } }, error: signInError }));
const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: resetError }));
const rpc = vi.fn(async () => usernameAnswer);

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  // The real one throws NEXT_REDIRECT, and the code after it must not run.
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("./rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true }),
  getClientIp: async () => "127.0.0.1",
}));
vi.mock("./site-url", () => ({ trustedOriginFor: () => "https://kivo.test" }));
vi.mock("./auth", () => ({
  isAuthConfigured: () => true,
  sanitizeRedirectPath: (value?: string) => (value?.startsWith("/") ? value : undefined),
}));
vi.mock("./profile", () => ({
  resolveViewerProfile: async () => ({ status: "ready", profile: { onboarding_completed: true } }),
}));
vi.mock("./supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signUp,
      signInWithPassword: signInWithPasswordCall,
      resetPasswordForEmail,
    },
  }),
  createServiceRoleSupabaseClient: () => ({ rpc }),
}));
vi.mock("./supabase/stored-accounts", () => ({
  MAX_STORED_ACCOUNTS: 3,
  findFreeSlot: async () => 0,
  stashSessionInSlot: async () => ({ error: null }),
}));

const { checkUsernameAvailability, requestPasswordReset, signInWithPassword, signUpWithPassword } =
  await import("./auth-actions");

/** A payload that passes every rule, so each test can break exactly one thing. */
function validSignUp(overrides: Partial<Parameters<typeof signUpWithPassword>[0]> = {}) {
  return {
    email: "New@Kivo.test",
    fullName: "Ada Obi",
    username: "AdaObi",
    password: "kivofootball1",
    confirmPassword: "kivofootball1",
    country: "NG",
    agreed: true,
    ...overrides,
  };
}

/** The actions redirect on success, which throws. Turn that back into a value. */
async function catchRedirect<T>(run: () => Promise<T>) {
  try {
    return { result: await run(), redirectedTo: null as string | null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return { result: undefined, redirectedTo: message.slice(9) };
    throw error;
  }
}

beforeEach(() => {
  usernameAnswer = { data: true, error: null };
  signUpError = null;
  signInError = null;
  resetError = null;
  signUp.mockClear();
  signInWithPasswordCall.mockClear();
  resetPasswordForEmail.mockClear();
  rpc.mockClear();
});

describe("signUpWithPassword — every rule re-checked on the server", () => {
  it("creates the account when everything is valid, normalising as it goes", async () => {
    expect(await signUpWithPassword(validSignUp())).toBeUndefined();

    expect(signUp).toHaveBeenCalledTimes(1);
    const [payload] = signUp.mock.calls[0] as unknown as [
      { email: string; password: string; options: { data: Record<string, string> } },
    ];
    // The address and the handle are stored folded, not as typed — one mailbox
    // is one account, and the handle must match what the citext column holds.
    expect(payload.email).toBe("new@kivo.test");
    expect(payload.options.data).toEqual({ full_name: "Ada Obi", username: "adaobi", country: "NG" });
  });

  it("refuses an unticked agreement, which a hand-made POST can simply omit", async () => {
    const result = await signUpWithPassword(validSignUp({ agreed: false }));

    expect(result?.field).toBe("agreed");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("refuses mismatched passwords", async () => {
    const result = await signUpWithPassword(validSignUp({ confirmPassword: "somethingelse1" }));

    expect(result?.field).toBe("confirmPassword");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("refuses a password that does not meet the stated rules", async () => {
    const result = await signUpWithPassword(validSignUp({ password: "football", confirmPassword: "football" }));

    expect(result?.field).toBe("password");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("refuses a country that is not an ISO 3166-1 alpha-2 code", async () => {
    for (const country of ["Nigeria", "ZZ", "", "N", "NGA"]) {
      signUp.mockClear();
      const result = await signUpWithPassword(validSignUp({ country }));
      expect(result?.field, `country=${JSON.stringify(country)}`).toBe("country");
      expect(signUp).not.toHaveBeenCalled();
    }
    // ...and accepts a lowercase or padded one, because the form is not the
    // only caller and the code is what gets stored either way.
    expect(await signUpWithPassword(validSignUp({ country: " gb " }))).toBeUndefined();
  });

  it("refuses a handle the shape rules reject", async () => {
    const result = await signUpWithPassword(validSignUp({ username: "ada obi" }));

    expect(result?.field).toBe("username");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("asks the database whether the handle is free, and stops when it is not", async () => {
    usernameAnswer = { data: false, error: null };

    const result = await signUpWithPassword(validSignUp());

    expect(rpc).toHaveBeenCalledWith("is_username_available", { p_username: "adaobi", p_exclude_profile_id: undefined });
    expect(result?.field).toBe("username");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("still creates the account when the availability check itself could not run", async () => {
    // "Could not tell" is not "taken". The UNIQUE constraint on
    // profiles.username is the real boundary; refusing here would turn a
    // Supabase hiccup into nobody being able to sign up at all.
    usernameAnswer = { data: null, error: { message: "boom" } };

    expect(await signUpWithPassword(validSignUp())).toBeUndefined();
    expect(signUp).toHaveBeenCalledTimes(1);
  });
});

describe("checkUsernameAvailability", () => {
  it("answers null rather than guessing for a handle that cannot be valid", async () => {
    expect(await checkUsernameAvailability("ab")).toEqual({ available: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalises before asking, so Puffnutz_ and puffnutz_ are one question", async () => {
    await checkUsernameAvailability("Puffnutz_");

    expect(rpc).toHaveBeenCalledWith("is_username_available", {
      p_username: "puffnutz_",
      p_exclude_profile_id: undefined,
    });
  });

  it("reports 'could not tell', not 'available', when the check fails", async () => {
    usernameAnswer = { data: null, error: { message: "boom" } };

    expect(await checkUsernameAvailability("adaobi")).toEqual({ available: null });
  });
});

describe("signInWithPassword", () => {
  it("signs in and lands the user inside the app", async () => {
    const { redirectedTo } = await catchRedirect(() => signInWithPassword("Founder@Kivo.test", "kivofootball1"));

    expect(redirectedTo).toBe("/home");
    expect(signInWithPasswordCall).toHaveBeenCalledWith({ email: "founder@kivo.test", password: "kivofootball1" });
  });

  it("gives the same answer for a wrong password and for an address with no account", async () => {
    signInError = { code: "invalid_credentials", message: "Invalid login credentials", status: 400 };

    const result = await signInWithPassword("nobody@kivo.test", "kivofootball1");

    // One sentence, and it must not distinguish the two cases — anything that
    // does is a membership oracle. It does point at the one recovery a KIVO
    // user is most likely to need: an account created before passwords existed.
    expect(result?.error).toMatch(/wrong email or password/i);
    expect(result?.error).toMatch(/forgot password/i);
    expect(result?.error).not.toMatch(/no account|not found|does not exist/i);
  });
});

describe("requestPasswordReset — never says whether the address has an account", () => {
  it("answers the same way for an address Supabase accepts", async () => {
    expect(await requestPasswordReset("founder@kivo.test")).toBeUndefined();
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it("answers the same way when Supabase reports a problem with the account", async () => {
    resetError = { code: "user_not_found", message: "User not found", status: 400 };

    // Identical to the success case: undefined, so the form advances to the code
    // screen either way and the caller learns nothing.
    expect(await requestPasswordReset("nobody@kivo.test")).toBeUndefined();
  });

  it("does report a throttle, because that is about the request and not the account", async () => {
    resetError = { code: "over_email_send_rate_limit", message: "after 47 seconds", status: 429 };

    const result = await requestPasswordReset("founder@kivo.test");

    expect(result?.error).toMatch(/too many/i);
    expect(result?.retryAfterSeconds).toBe(47);
  });

  it("points the emailed link at the screen that actually sets a password", async () => {
    await requestPasswordReset("founder@kivo.test");

    const [, options] = resetPasswordForEmail.mock.calls[0] as unknown as [string, { redirectTo: string }];
    expect(options.redirectTo).toBe("https://kivo.test/auth/callback?next=%2Freset-password");
  });
});
