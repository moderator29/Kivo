"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Check, Copy, Download, Share2, MessageCircle } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { MATCH_CARD_CANVAS, MATCH_CARD_LAYOUT, type MatchShareCardData } from "@/lib/football/match-share-card";
import { KIVO_MATCH_CARD_BACKGROUND_PATH } from "@/lib/kivo-assets";

/** px box (MATCH_CARD_LAYOUT's own units, against the template's fixed
 * 1536x1024 canvas) -> a responsive, percentage-based absolute-position
 * style — so this on-page preview and the /share-card PNG route stay
 * pixel-locked to the exact same layout at any container width. */
function boxStyle(box: { top: number; left: number; width: number; height: number }): React.CSSProperties {
  return {
    position: "absolute",
    top: `${(box.top / MATCH_CARD_CANVAS.height) * 100}%`,
    left: `${(box.left / MATCH_CARD_CANVAS.width) * 100}%`,
    width: `${(box.width / MATCH_CARD_CANVAS.width) * 100}%`,
    height: `${(box.height / MATCH_CARD_CANVAS.height) * 100}%`,
  };
}

function teamNameFontClass(name: string): string {
  if (name.length > 20) return "text-[3vw] sm:text-[13px]";
  if (name.length > 14) return "text-[3.4vw] sm:text-[15px]";
  return "text-[4vw] sm:text-[18px]";
}

function statusColor(state: MatchShareCardData["state"]): string {
  if (state === "live") return "text-live";
  if (state === "finished") return "text-kivo-cyan";
  return "text-foreground-muted";
}

/**
 * The live, on-page rendering of a real fixture's match share card —
 * template artwork (kivo-match-card-background.webp) as the base layer,
 * real fixture data composited on top in KIVO's own glass-chip language,
 * exactly matching MATCH_CARD_LAYOUT (the same geometry the downloadable
 * PNG at /api/matches/[id]/share-card renders from), so what a user sees
 * here is what they get when they download or share it.
 */
export function MatchShareCard({ fixtureId, data, matchUrl }: { fixtureId: string; data: MatchShareCardData; matchUrl: string }) {
  const [pending, startTransition] = useTransition();
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // KN-54: the share flow ended at a downloaded PNG. A picture of a scoreline
  // with no way to send the link alongside it is a dead end on desktop, where
  // navigator.share often isn't available at all.
  const [copied, setCopied] = useState(false);

  const shareText =
    data.state === "upcoming"
      ? `${data.homeTeam.name} vs ${data.awayTeam.name} kicks off ${data.kickoffLabel} — on KIVO.`
      : `${data.homeTeam.name} ${data.homeScore ?? 0} - ${data.awayScore ?? 0} ${data.awayTeam.name} — on KIVO.`;

  async function fetchCardBlob(): Promise<Blob> {
    const res = await fetch(`/api/matches/${fixtureId}/share-card`);
    if (!res.ok) throw new Error("share-card request failed");
    return res.blob();
  }

  function handleDownload() {
    setError(null);
    startTransition(async () => {
      try {
        const blob = await fetchCardBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `kivo-${data.homeTeam.shortName ?? data.homeTeam.name}-vs-${data.awayTeam.shortName ?? data.awayTeam.name}.png`.replace(/\s+/g, "-").toLowerCase();
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setError("Couldn't generate the card. Try again.");
      }
    });
  }

  async function handleShare() {
    setError(null);
    // Native share sheet first (mobile browsers, some desktop browsers):
    // shares the actual composited image file, not just a link.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        const blob = await fetchCardBlob();
        const file = new File([blob], "kivo-match-card.png", { type: "image/png" });
        const canShareFile = !navigator.canShare || navigator.canShare({ files: [file] });
        if (canShareFile) {
          await navigator.share({ files: [file], title: "KIVO", text: shareText, url: matchUrl });
          return;
        }
      } catch (shareError) {
        // AbortError = the user cancelled the native share sheet, not a
        // failure — nothing to fall back to, just stop quietly.
        if (shareError instanceof Error && shareError.name === "AbortError") return;
        // Any other failure (no file-share support, permission denied,
        // etc.) falls through to the explicit intent links below.
      }
    }
    setShareMenuOpen(true);
  }

  async function handleCopyLink() {
    setError(null);
    try {
      await navigator.clipboard.writeText(matchUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be denied outright (insecure context, permission
      // policy). Saying so beats a button that silently does nothing.
      setError("Couldn't copy the link. Long-press the address bar instead.");
    }
  }

  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(matchUrl);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl kivo-glass-sharp">
        <Image
          src={KIVO_MATCH_CARD_BACKGROUND_PATH}
          alt=""
          fill
          sizes="(min-width: 672px) 640px, 100vw"
          className="object-cover"
          priority={false}
        />

        {/* Status pill */}
        <div
          style={boxStyle(MATCH_CARD_LAYOUT.statusPill)}
          className="flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-[#0a1020]"
        >
          {data.state === "live" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" />}
          <span className={`truncate px-1 text-[2.6vw] font-bold uppercase tracking-wider sm:text-xs ${statusColor(data.state)}`}>
            {data.state === "upcoming" ? data.kickoffLabel : data.state === "live" && data.minuteLabel ? `${data.statusLabel} · ${data.minuteLabel}` : data.statusLabel}
          </span>
        </div>

        {/* Team names */}
        <div style={boxStyle(MATCH_CARD_LAYOUT.teamNameLeft)} className="flex items-center justify-center">
          <span className={`truncate text-center font-bold text-foreground ${teamNameFontClass(data.homeTeam.name)}`}>
            {data.homeTeam.name}
          </span>
        </div>
        <div style={boxStyle(MATCH_CARD_LAYOUT.teamNameRight)} className="flex items-center justify-center">
          <span className={`truncate text-center font-bold text-foreground ${teamNameFontClass(data.awayTeam.name)}`}>
            {data.awayTeam.name}
          </span>
        </div>

        {/* Crests -- shield interiors are already empty in the artwork. */}
        <div style={boxStyle(MATCH_CARD_LAYOUT.shieldLeft)} className="flex items-center justify-center">
          <TeamCrest crestUrl={data.homeTeam.crestUrl} name={data.homeTeam.name} size={64} />
        </div>
        <div style={boxStyle(MATCH_CARD_LAYOUT.shieldRight)} className="flex items-center justify-center">
          <TeamCrest crestUrl={data.awayTeam.crestUrl} name={data.awayTeam.name} size={64} />
        </div>

        {/* Score / VS */}
        <div
          style={boxStyle(MATCH_CARD_LAYOUT.scorePanel)}
          className="flex items-center justify-center rounded-2xl border border-white/10 bg-[#0a1020]"
        >
          {data.state === "upcoming" ? (
            <span className="text-[6vw] font-extrabold tracking-widest text-foreground sm:text-3xl">VS</span>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-[9vw] font-extrabold text-foreground sm:text-5xl">{data.homeScore ?? 0}</span>
              <span className="text-[4vw] font-semibold text-foreground-subtle sm:text-2xl">-</span>
              <span className="text-[9vw] font-extrabold text-foreground sm:text-5xl">{data.awayScore ?? 0}</span>
            </div>
          )}
        </div>

        {/* Goal events -- covers the template's own baked example rows. */}
        <div
          style={boxStyle(MATCH_CARD_LAYOUT.eventsLeft)}
          className="flex flex-col justify-center gap-1.5 rounded-2xl border border-white/10 bg-[#0a1020] px-3 py-2"
        >
          {data.homeGoalEvents.map((event, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[2.4vw] sm:text-xs">
              <span className="font-bold text-foreground">
                {event.minute}
                {event.addedTime ? `+${event.addedTime}` : ""}&apos;
              </span>
              <span className="h-1 w-1 shrink-0 rounded-full bg-kivo-cyan" />
              <span className="truncate text-foreground-muted">
                {event.playerName}
                {event.isOwnGoal ? " (OG)" : ""}
              </span>
            </div>
          ))}
        </div>
        <div
          style={boxStyle(MATCH_CARD_LAYOUT.eventsRight)}
          className="flex flex-col justify-center gap-1.5 rounded-2xl border border-white/10 bg-[#0a1020] px-3 py-2"
        >
          {data.awayGoalEvents.map((event, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[2.4vw] sm:text-xs">
              <span className="font-bold text-foreground">
                {event.minute}
                {event.addedTime ? `+${event.addedTime}` : ""}&apos;
              </span>
              <span className="h-1 w-1 shrink-0 rounded-full bg-kivo-cyan" />
              <span className="truncate text-foreground-muted">
                {event.playerName}
                {event.isOwnGoal ? " (OG)" : ""}
              </span>
            </div>
          ))}
        </div>

        {/* Competition / venue caption */}
        <div style={boxStyle(MATCH_CARD_LAYOUT.caption)} className="flex items-center justify-center">
          <span className="truncate text-[2.4vw] font-semibold uppercase tracking-wide text-foreground-subtle sm:text-xs">
            {data.competitionName}
            {data.venueLabel ? ` · ${data.venueLabel}` : ""}
          </span>
        </div>

        <div style={boxStyle(MATCH_CARD_LAYOUT.watermark)} className="flex items-center justify-end">
          <span className="text-[2.6vw] font-bold tracking-widest text-kivo-cyan sm:text-sm">KIVO</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={pending}
          aria-busy={pending}
          className="kivo-gradient-prime flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
          {pending ? "Preparing…" : "Download"}
        </button>
        <button
          type="button"
          onClick={handleShare}
          disabled={pending}
          className="kivo-glass-sharp flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-50"
        >
          <Share2 className="h-3.5 w-3.5" strokeWidth={2} />
          Share
        </button>
        <button
          type="button"
          onClick={handleCopyLink}
          className="kivo-glass-sharp flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-live" strokeWidth={2} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>

      {/* KN-54: the card is a picture; the link is the product. With the whole
          app behind the door, whoever receives this link needs an account —
          saying so here means the sharer knows what they are sending rather
          than finding out from a confused reply. The link itself does now
          survive the gate: the sign-in page carries the destination through
          and lands them on this exact match afterwards (KN-123). */}
      <p className="text-[11px] leading-snug text-foreground-subtle">
        The link opens this match on KIVO. Anyone without an account signs in first, then lands right here.
      </p>

      {shareMenuOpen && (
        <div className="kivo-glass flex flex-wrap items-center gap-2 rounded-xl p-3">
          <span className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
            Share via
          </span>
          <a
            href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="kivo-glass-sharp rounded-lg px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-2"
          >
            WhatsApp
          </a>
          <a
            href={`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="kivo-glass-sharp rounded-lg px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-2"
          >
            X
          </a>
          <a
            href={`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="kivo-glass-sharp rounded-lg px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-2"
          >
            Telegram
          </a>
        </div>
      )}

      {error && (
        <span className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </span>
      )}
    </div>
  );
}
