"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Check, X } from "lucide-react";
import { checkUsernameAvailable, updateUsername } from "@/app/(app)/profile/actions";
import { ProfileSaveBar } from "@/components/profile/profile-save-bar";
import { useSaveReturn } from "@/hooks/use-save-return";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const AVAILABILITY_DEBOUNCE_MS = 450;

/**
 * The handle on its own page.
 *
 * Same debounced `is_username_available` check the inline editor and
 * onboarding both use — `profiles` has no cross-user SELECT policy, so this
 * cannot be a client query — but with room to say what the rules are before
 * someone breaks them, instead of a 20px input that only explains itself in an
 * error.
 *
 * `router.refresh()` after a successful save because the handle is part of the
 * URL of this profile's public page: everything cached against the old one is
 * now wrong.
 */
export function HandleEditor({ username }: { username: string }) {
  const router = useRouter();
  const [value, setValue] = useState(username);
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  // The founder's ask: a save ends the errand. See useSaveReturn — the
  // destination is the one the back control names, and the control stays.
  const returnToCaller = useSaveReturn();

  const requestId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  function handleChange(raw: string) {
    // Fold case on the way in, same fix as onboarding and the inline editor:
    // the server lowercases but `pattern="[a-z0-9_]+"` rejects the raw
    // uppercase, so a handle could read "Available" and still refuse to submit.
    const next = raw.toLowerCase();
    setValue(next);
    setSaved(false);
    setError(null);
    if (debounce.current) clearTimeout(debounce.current);

    const candidate = next.trim();
    if (!USERNAME_PATTERN.test(candidate) || candidate === username.toLowerCase()) {
      setAvailability("idle");
      return;
    }

    setAvailability("checking");
    const id = ++requestId.current;
    debounce.current = setTimeout(() => {
      checkUsernameAvailable(candidate).then((result) => {
        if (requestId.current !== id) return;
        setAvailability(result.available === null ? "idle" : result.available ? "available" : "taken");
      });
    }, AVAILABILITY_DEBOUNCE_MS);
  }

  const candidate = value.trim();
  const valid = USERNAME_PATTERN.test(candidate);
  const unchanged = candidate === username.toLowerCase();

  return (
    <form
      className="flex flex-col gap-5"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await updateUsername(formData);
          if (result.error) {
            setError(result.error);
            return;
          }
          setSaved(true);
          router.refresh();
          returnToCaller();
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="username" className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Your handle
        </label>
        <div className="kivo-field flex items-center gap-2 px-4 py-3">
          <AtSign className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
          <input
            id="username"
            name="username"
            value={value}
            onChange={(event) => handleChange(event.target.value)}
            minLength={3}
            maxLength={24}
            pattern="[a-z0-9_]+"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full bg-transparent text-base text-foreground outline-none"
          />
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {availability === "checking" && (
              <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-foreground-subtle/30 border-t-foreground-subtle" />
            )}
            {availability === "available" && <Check className="h-4 w-4 text-live" strokeWidth={1.75} />}
            {availability === "taken" && <X className="h-4 w-4 text-critical" strokeWidth={1.75} />}
          </span>
        </div>
        <p className="px-1 text-[11px] leading-relaxed text-foreground-subtle">
          3–24 characters. Lowercase letters, numbers and underscores only. Your profile lives at{" "}
          <span className="text-foreground-muted">kivo.app/u/{candidate || username}</span>.
        </p>
        {availability === "taken" && <p className="px-1 text-[11px] text-critical">That handle is taken.</p>}
        {availability === "available" && <p className="px-1 text-[11px] text-live">That handle is free.</p>}
      </div>

      <ProfileSaveBar
        pending={pending}
        disabled={!valid || unchanged || availability === "taken"}
        saved={saved}
        error={error}
        label="Save handle"
      />
    </form>
  );
}
