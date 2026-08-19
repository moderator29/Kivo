"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Check, Copy, Download, Loader2, Plus, Share2 } from "lucide-react";
import { uploadBackground } from "@/app/(app)/profile/background-actions";
import {
  OWN_BACKGROUND_ID,
  SIGNATURE_BACKGROUND_ID,
  type ShareBackground,
  type ShareBackgroundId,
} from "@/lib/share-cards/backgrounds";
import type { ShareCardKind } from "@/lib/share-cards/types";

/**
 * KIVO's share sheet — one component behind every share card in the product.
 *
 * The shape is the founder's reference (pump.fun's share sheet): a live
 * preview of the card, the actions directly beneath it, and a horizontal row
 * of background thumbnails that restyle the card as you tap them, ending in a
 * "+" tile for your own picture.
 *
 * The preview is an `<img>` pointed at `/api/share-card` — the exact bytes
 * "Save" downloads and "Share" sends. That is the whole reason there is no
 * client-side card renderer: a preview drawn separately from the file is a
 * preview that eventually lies about what you're sharing, and a share card is
 * seen by people who cannot check it against the app.
 *
 * The previous card stays on screen while the next background renders, so
 * tapping through backgrounds reads as a restyle rather than a reload.
 */

export type ShareSheetProps = {
  kind: ShareCardKind;
  id: string;
  /** Second player on a comparison; highlighted club on a league table. */
  secondaryId?: string | null;
  /** What the card is, for the heading and the saved filename. */
  title: string;
  /** The KIVO page this card came from — copied, and sent alongside the image
   * by native share targets that accept both. */
  shareUrl: string;
  shareText: string;
  backgrounds: ShareBackground[];
  /** Whether the viewer already has an uploaded cover. Drives whether the
   * "Yours" tile exists before they upload anything in this session. */
  canUpload: boolean;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export function ShareSheet({
  kind,
  id,
  secondaryId,
  title,
  shareUrl,
  shareText,
  backgrounds: initialBackgrounds,
  canUpload,
}: ShareSheetProps) {
  const [backgrounds, setBackgrounds] = useState(initialBackgrounds);
  const [backgroundId, setBackgroundId] = useState<ShareBackgroundId>(SIGNATURE_BACKGROUND_ID);
  const [status, setStatus] = useState<null | { tone: "info" | "error"; message: string }>(null);
  const [copied, setCopied] = useState(false);
  const [busy, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  // Which card URL the <img> has actually finished with. Derived state rather
  // than an effect that resets a flag when `cardUrl` changes: the effect
  // version renders once with the previous background still marked "ready",
  // which is exactly the frame where the old card flashes as final.
  const [settledUrl, setSettledUrl] = useState<{ url: string; failed: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams({ kind, id, bg: backgroundId });
  if (secondaryId) params.set("b", secondaryId);
  const cardUrl = `/api/share-card?${params.toString()}`;
  const fileName = `kivo-${slugify(title)}.png`;

  /**
   * Settles the preview from the element itself at attach time.
   *
   * Found in a browser, not in the code: the first `<img>` is server-rendered,
   * so the browser can finish loading it *before* React attaches `onLoad`
   * during hydration — and a load event that has already happened is never
   * delivered. The sheet then sits at `opacity-40` with a spinner over a card
   * that has actually finished, permanently. Probed directly: `complete: true`,
   * `naturalWidth: 1080`, `className: "… opacity-40"`, spinner still mounted.
   * It bites hardest on exactly the fast paths — a warm route, a cached card.
   *
   * `cardUrl` is in the dependency list on purpose: React re-runs the callback
   * whenever it changes, which also covers the case where the next background
   * is already in the browser cache and completes before a load event can be
   * observed. When the new URL genuinely has to be fetched, `complete` is false
   * here and `onLoad`/`onError` take it from there as normal.
   */
  const settleFromElement = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !img.complete) return;
      setSettledUrl({ url: cardUrl, failed: img.naturalWidth === 0 });
    },
    [cardUrl],
  );

  const rendering = settledUrl?.url !== cardUrl;
  const renderFailed = settledUrl?.url === cardUrl && settledUrl.failed;

  async function fetchCardBlob(): Promise<Blob> {
    const response = await fetch(cardUrl);
    if (!response.ok) throw new Error(`share-card ${response.status}`);
    return response.blob();
  }

  function handleSave() {
    setStatus(null);
    startTransition(async () => {
      try {
        const blob = await fetchCardBlob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      } catch {
        setStatus({ tone: "error", message: "Couldn't save the card. Try again." });
      }
    });
  }

  function handleCopy() {
    setStatus(null);
    startTransition(async () => {
      // Copying the picture itself is what people actually want when they're
      // about to paste into a chat. It needs a secure context and a browser
      // with async ClipboardItem; where that isn't available the link is a
      // genuinely useful second-best, and the message says which one happened
      // rather than leaving the user guessing what's on their clipboard.
      try {
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
          const blob = await fetchCardBlob();
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
          setCopied(true);
          setStatus({ tone: "info", message: "Card copied. Paste it anywhere." });
          window.setTimeout(() => setCopied(false), 2500);
          return;
        }
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setStatus({ tone: "info", message: "Link copied — this browser can't copy images." });
        window.setTimeout(() => setCopied(false), 2500);
      } catch {
        setStatus({ tone: "error", message: "Couldn't copy. Long-press the card to save it instead." });
      }
    });
  }

  function handleShare() {
    setStatus(null);
    startTransition(async () => {
      try {
        const blob = await fetchCardBlob();
        const file = new File([blob], fileName, { type: blob.type || "image/png" });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({ files: [file], title: "KIVO", text: shareText, url: shareUrl });
          return;
        }
        // No native share sheet (most desktop browsers). Saving the file is
        // the honest fallback — a "share" button that silently does nothing
        // is worse than one that hands you the picture.
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
        setStatus({ tone: "info", message: "Saved the card — this browser has no share sheet." });
      } catch (error) {
        // A cancelled native share sheet is not a failure.
        if (error instanceof Error && error.name === "AbortError") return;
        setStatus({ tone: "error", message: "Couldn't share the card. Try saving it instead." });
      }
    });
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setStatus(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("background", file);
    const result = await uploadBackground(formData);
    setUploading(false);

    if (result.error || !result.url) {
      setStatus({ tone: "error", message: result.error ?? "Upload failed. Try again." });
      return;
    }

    setBackgrounds((current) => [
      ...current.filter((background) => background.id !== OWN_BACKGROUND_ID),
      { id: OWN_BACKGROUND_ID, label: "Yours", previewSrc: result.url as string },
    ]);
    setBackgroundId(OWN_BACKGROUND_ID);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl kivo-glass-sharp">
        {/* eslint-disable-next-line @next/next/no-img-element -- the preview must
            be the image route's own bytes, unoptimised and uncached, so that
            what is previewed is exactly what gets saved. */}
        <img
          ref={settleFromElement}
          src={cardUrl}
          alt={`${title} preview`}
          className={`h-full w-full object-cover transition-opacity duration-300 ${rendering ? "opacity-40" : "opacity-100"}`}
          onLoad={() => setSettledUrl({ url: cardUrl, failed: false })}
          onError={() => setSettledUrl({ url: cardUrl, failed: true })}
        />
        {rendering && !renderFailed && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-accent" strokeWidth={1.75} />
          </div>
        )}
        {renderFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-3 px-6 text-center">
            <p className="text-sm font-medium text-foreground">This card can&apos;t be made yet.</p>
            <p className="max-w-xs text-xs text-foreground-subtle">
              KIVO only puts real numbers on a card. When there are some for this one, it will render here.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || renderFailed}
          aria-busy={busy}
          className="kivo-gradient-prime flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
          Save
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={busy || renderFailed}
          className="kivo-glass-sharp flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-50"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-live" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={handleShare}
          disabled={busy || renderFailed}
          className="kivo-glass-sharp flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-50"
        >
          <Share2 className="h-3.5 w-3.5" strokeWidth={2} />
          Share
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Background</span>
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
          {backgrounds.map((background) => {
            const selected = background.id === backgroundId;
            return (
              <button
                key={background.id}
                type="button"
                onClick={() => setBackgroundId(background.id)}
                aria-pressed={selected}
                aria-label={background.label}
                className={`relative h-16 w-16 shrink-0 snap-start overflow-hidden rounded-xl border transition ${
                  selected ? "border-accent ring-2 ring-accent/40" : "border-hairline hover:border-hairline-strong"
                }`}
              >
                {background.previewSrc ? (
                  <Image src={background.previewSrc} alt="" fill sizes="64px" className="object-cover" unoptimized={background.id === OWN_BACKGROUND_ID} />
                ) : (
                  <span className="kivo-gradient-prime absolute inset-0" aria-hidden="true" />
                )}
              </button>
            );
          })}

          {canUpload && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Upload your own background"
              className="flex h-16 w-16 shrink-0 snap-start items-center justify-center rounded-xl border border-dashed border-hairline-strong text-foreground-subtle transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Plus className="h-4 w-4" strokeWidth={1.75} />}
            </button>
          )}
        </div>
        {canUpload && (
          <p className="text-[11px] leading-snug text-foreground-subtle">
            Your upload becomes your profile cover too — KIVO keeps one picture of yours, not two. PNG or JPEG render
            on the card; a WEBP upload works as a cover but falls back to the KIVO backdrop here.
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {status && (
        <span
          role="status"
          aria-live="polite"
          className={`text-xs ${status.tone === "error" ? "text-critical" : "text-foreground-muted"}`}
        >
          {status.message}
        </span>
      )}
    </div>
  );
}
