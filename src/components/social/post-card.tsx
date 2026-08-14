"use client";

import { useState, useTransition } from "react";
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
  index?: number;
}

export function PostCard({ id, body, createdAt, authorName, likeCount, likedByViewer, index = 0 }: PostCardProps) {
  const [optimisticLiked, setOptimisticLiked] = useState(likedByViewer);
  const [optimisticCount, setOptimisticCount] = useState(likeCount);
  const [pending, startTransition] = useTransition();

  function handleLike() {
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
      className="kivo-glass flex flex-col gap-3 rounded-2xl p-4"
    >
      <div className="flex items-center gap-2">
        <div className="kivo-gradient-prime flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-kivo-white">
          {authorName.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{authorName}</span>
          <span className="text-xs text-foreground-subtle">{timeAgo(createdAt)}</span>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{body}</p>
      <button
        onClick={handleLike}
        disabled={pending}
        aria-pressed={optimisticLiked}
        className={cn(
          "flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors disabled:opacity-70",
          optimisticLiked ? "text-critical" : "text-foreground-subtle hover:text-foreground-muted",
        )}
      >
        <motion.span
          key={optimisticLiked ? "liked" : "unliked"}
          initial={{ scale: 0.6 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
          className="flex items-center"
        >
          <Heart className="h-4 w-4" strokeWidth={1.75} fill={optimisticLiked ? "currentColor" : "none"} />
        </motion.span>
        {optimisticCount > 0 ? optimisticCount : "Like"}
      </button>
    </motion.article>
  );
}
