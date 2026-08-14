"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
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
}

export function PostCard({ id, body, createdAt, authorName, likeCount, likedByViewer }: PostCardProps) {
  const [optimisticLiked, setOptimisticLiked] = useState(likedByViewer);
  const [optimisticCount, setOptimisticCount] = useState(likeCount);
  const [, startTransition] = useTransition();

  function handleLike() {
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
    <article className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
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
        aria-pressed={optimisticLiked}
        className={cn(
          "flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors",
          optimisticLiked ? "text-critical" : "text-foreground-subtle hover:text-foreground-muted",
        )}
      >
        <Heart className="h-4 w-4" strokeWidth={1.75} fill={optimisticLiked ? "currentColor" : "none"} />
        {optimisticCount > 0 ? optimisticCount : "Like"}
      </button>
    </article>
  );
}
