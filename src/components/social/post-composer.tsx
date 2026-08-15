"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "motion/react";
import { createPost } from "@/app/(app)/social/actions";

const MAX_LENGTH = 2000;

export function PostComposer({
  signedIn,
  fixtureId,
  placeholder = "What's your take?",
}: {
  signedIn: boolean;
  /** Scopes the created post to a fixture's Match Room (see match-room.tsx) instead of the general feed. */
  fixtureId?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        if (!signedIn) {
          router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
          return;
        }
        setError(null);
        startTransition(async () => {
          const result = await createPost(formData);
          if (result.error) {
            setError(result.error);
          } else {
            formRef.current?.reset();
          }
        });
      }}
      className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_8px_30px_-8px_rgba(37,99,255,0.35)]"
    >
      {fixtureId && <input type="hidden" name="fixture_id" value={fixtureId} />}
      <textarea
        name="body"
        required={signedIn}
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder={signedIn ? placeholder : "Sign up to share your take."}
        onFocus={(e) => {
          if (!signedIn) e.currentTarget.blur();
        }}
        className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
      />
      <div className="flex items-center justify-between">
        {error ? <span className="text-xs text-critical">{error}</span> : <span />}
        <motion.button
          type="submit"
          disabled={pending}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          className="kivo-gradient-prime rounded-xl px-4 py-1.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Posting…" : signedIn ? "Post" : "Sign up to post"}
        </motion.button>
      </div>
    </form>
  );
}
