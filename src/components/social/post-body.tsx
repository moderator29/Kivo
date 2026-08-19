"use client";

import { Fragment, useRef, useState } from "react";
import { useIsClamped } from "@/hooks/use-clamped";
import { cn } from "@/lib/utils";

// Matches bare http(s) URLs; the capturing group means String.split() keeps the
// matched substrings in the result, alternating with the surrounding plain text.
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
// Trailing punctuation that's almost always sentence punctuation rather than
// part of the URL itself (e.g. "check this out: https://kivo.app." -> the
// period shouldn't be swallowed into the href).
const TRAILING_PUNCTUATION = /[),.;:!?'"\]}]+$/;

/**
 * Splits a post body into plain-text and link segments for safe rendering.
 * Never builds HTML strings - each URL becomes a real React <a> element, so
 * JSX escaping (not string concatenation) is what keeps this XSS-safe.
 */
export function linkifyBody(body: string) {
  const parts = body.split(URL_PATTERN);
  return parts.map((part, i) => {
    // split() with a single capturing group alternates plain text (even
    // indices) with matched URLs (odd indices).
    if (i % 2 === 0 || !part) return part;
    const trailingMatch = part.match(TRAILING_PUNCTUATION);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    if (!url) return part;
    return (
      <Fragment key={i}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 hover:text-accent/80"
        >
          {url}
        </a>
        {trailing}
      </Fragment>
    );
  });
}

/**
 * A post's words, clamped until the reader asks for the rest.
 *
 * Lifted out of PostCard so a Match Room message renders exactly the same body
 * — same linkifying, same clamp, same "Show more" — at a tighter clamp. A live
 * room where one fan's essay pushes eight other people off the screen is not a
 * live room, so `lines` defaults to the feed's five and the Room passes three.
 */
export function PostBody({ body, lines = 5 }: { body: string; lines?: 3 | 5 }) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  // KN-70: one ResizeObserver for every clamped body in the app, not one per
  // post. See src/hooks/use-clamped.ts.
  const isOverflowing = useIsClamped(bodyRef, body);

  return (
    <div className="flex flex-col items-start gap-1">
      <p
        ref={bodyRef}
        className={cn(
          "whitespace-pre-wrap text-sm leading-relaxed text-foreground",
          // Tailwind needs the full class name literal in source to generate
          // it, so both clamps are written out rather than interpolated.
          !expanded && (lines === 3 ? "line-clamp-3" : "line-clamp-5"),
        )}
      >
        {linkifyBody(body)}
      </p>
      {(isOverflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-xs font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
