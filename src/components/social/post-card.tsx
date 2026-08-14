"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { motion } from "motion/react";
import { toggleLike } from "@/app/(app)/social/actions";
import { cn } from "@/lib/utils";

function timeAgo(isoDate: string) {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface PostCardProps {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  likeCount: number;
  likedByViewer: boolean;
  signedIn: boolean;
  index?: number;
}

export function PostCard({ id, body, createdAt, authorName, likeCount, likedByViewer, signedIn, index = 0 }: PostCardProps) {
  const router = useRouter();
  const [optimisticLiked, setOptimisticLiked] = useState(likedByViewer);
  const [optimisticCount, setOptimisticCount] = useState(likeCount);
  const [pending, startTransition] = useTransition();

  function handleLike() {
    if (!signedIn) {
      router.push("/sign-up");
      return;
    }
    // Guard against rapid double-clicks racing two toggles against the server —
    // the button is also disabled while pending, this is defense in depth.
    if (pending) return;

    const nextLiked = !optimisticLiked;
    setOptimisticLiked(nextLiked);
    setOptimisticCount((c) => c + (nextLiked ? 1 : -1));
    startTransition(async () => {
      const result = await toggleLike(id, optimisticLiked);
      if (result.error) {
        // Revert on failure — never leave the UI claiming a reaction that didn't persist.
        setOptimisticLiked(optimisticLiked);
        setOptimisticCount(likeCount);
      }
    });
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 6) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
      className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition-shadow duration-300 hover:shadow-[0_12px_40px_-16px_rgba(37,99,255,0.35)]"
    >
      <div className="flex items-center gap-2">
        <div className="kivo-gradient-prime flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-kivo-white">
          {authorName.charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{authorName}</span>
          <span className="text-xs text-foreground-subtle">{timeAgo(createdAt)}</span>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{body}</p>
      <motion.button
        onClick={handleLike}
        disabled={pending}
        aria-pressed={optimisticLiked}
        whileTap={{ scale: 0.88 }}
        className={cn(
          "flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-70",
          optimisticLiked ? "text-critical" : "text-foreground-subtle hover:text-foreground-muted",
        )}
      >
        <motion.span
          key={optimisticLiked ? "liked" : "unliked"}
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 600, damping: 12 }}
          className="flex items-center"
        >
          <Heart className="h-4 w-4" strokeWidth={1.75} fill={optimisticLiked ? "currentColor" : "none"} />
        </motion.span>
        {optimisticCount > 0 ? optimisticCount : "Like"}
      </motion.button>
    </motion.article>
  );
}
