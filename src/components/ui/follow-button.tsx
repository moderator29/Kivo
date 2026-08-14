"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toggleFollow } from "@/app/(app)/follow-actions";

type FollowTargetType = "team" | "player" | "competition";

type FollowButtonProps = {
  targetType: FollowTargetType;
  targetId: string;
  initialFollowing: boolean;
  size?: "sm" | "md";
};

export function FollowButton({ targetType, targetId, initialFollowing, size = "md" }: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (pending) return;
    const previous = following;
    setFollowing(!previous);
    startTransition(async () => {
      const result = await toggleFollow(targetType, targetId, previous);
      if (result.error) setFollowing(previous);
      else setFollowing(result.following);
    });
  }

  const dimension = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleClick}
      aria-pressed={following}
      aria-label={following ? "Unfollow" : "Follow"}
      className={`flex shrink-0 items-center justify-center rounded-full border transition disabled:opacity-60 ${dimension} ${
        following ? "border-achievement/40 bg-achievement/10" : "border-white/10 hover:bg-white/5"
      }`}
    >
      <Star
        className={`${iconSize} transition ${following ? "fill-achievement text-achievement" : "text-foreground-subtle"}`}
        strokeWidth={1.75}
      />
    </button>
  );
}
