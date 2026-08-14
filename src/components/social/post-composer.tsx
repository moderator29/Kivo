"use client";

import { useRef, useState, useTransition } from "react";
import { createPost } from "@/app/(app)/social/actions";

const MAX_LENGTH = 2000;

export function PostComposer() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
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
      className="kivo-glass flex flex-col gap-3 rounded-2xl p-4"
    >
      <textarea
        name="body"
        required
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder="What's your take?"
        className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
      />
      <div className="flex items-center justify-between">
        {error ? <span className="text-xs text-critical">{error}</span> : <span />}
        <button
          type="submit"
          disabled={pending}
          className="kivo-gradient-prime rounded-xl px-4 py-1.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
