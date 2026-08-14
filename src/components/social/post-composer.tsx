"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createPost } from "@/app/(app)/social/actions";

const MAX_LENGTH = 2000;

export function PostComposer({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        if (!signedIn) {
          router.push("/sign-up");
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
      <textarea
        name="body"
        required
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder={signedIn ? "What's your take?" : "Sign up to share your take."}
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
