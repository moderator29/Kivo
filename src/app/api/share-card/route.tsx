import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { fetchImageDataUri } from "@/lib/football/fetch-image-data-uri";
import { isUuid } from "@/lib/params";
import { loadShareCard } from "@/lib/share-cards/load";
import { renderShareCard, shareCardImageUrls, type ImageResolver } from "@/lib/share-cards/render";
import { SHARE_CARD_CANVAS, isShareCardKind } from "@/lib/share-cards/types";
import {
  OWN_BACKGROUND_ID,
  SIGNATURE_BACKGROUND_ID,
  isShareBackgroundId,
  shareBackgroundImagePath,
  type ShareBackgroundId,
} from "@/lib/share-cards/backgrounds";

export const runtime = "nodejs";

/**
 * The one place a KIVO share card becomes pixels.
 *
 * `ShareSheet` previews a card by pointing an `<img>` at this route, and saves
 * one by fetching the same URL — so the preview and the file are literally the
 * same bytes. There is no second renderer to drift from.
 *
 * Query parameters, all validated before anything is read or fetched:
 *   kind — one of the nine card kinds
 *   id   — the primary entity (fixture / player / season / transfer / …)
 *   b    — optional secondary entity (second player; highlighted club)
 *   bg   — a background id: "signature", a KIVO background, or "own"
 *
 * Authorisation is Supabase RLS, through the viewer's own cookie-bound client.
 * A prediction, fantasy or Copilot card simply returns 404 for anyone the
 * database wouldn't show those rows to.
 */

const backgroundCache = new Map<string, Promise<string | null>>();

/**
 * The background layer, as a data URI the rasteriser can actually decode.
 *
 * KIVO's background art ships as WEBP and `next/og`'s renderer cannot decode
 * WEBP at all — it throws "u2 is not iterable" inside resvg, which is a real
 * failure this codebase already hit once on the match card. The fix there and
 * here is the same shape: a committed non-WEBP derivative used only by the
 * image route (`scripts/generate-share-card-backgrounds.mjs`). Read once per
 * server instance, because the file never changes at runtime.
 *
 * A user's own uploaded cover has no derivative — it is fetched live and
 * sniffed by `fetchImageDataUri`, which only ever returns PNG or JPEG bytes.
 * A WEBP upload therefore resolves to null here, and the card falls back to
 * KIVO's gradient rather than failing to render. That is a real, visible
 * limitation of "use my own picture", not a silent one: the sheet says so.
 */
function loadBackgroundDataUri(id: ShareBackgroundId, uploadedUrl: string | null): Promise<string | null> {
  if (id === SIGNATURE_BACKGROUND_ID) return Promise.resolve(null);

  if (id === OWN_BACKGROUND_ID) {
    return uploadedUrl ? fetchImageDataUri(uploadedUrl) : Promise.resolve(null);
  }

  const cached = backgroundCache.get(id);
  if (cached) return cached;

  const promise = readFile(path.join(process.cwd(), "public", shareBackgroundImagePath(id)))
    .then((buffer) => `data:image/jpeg;base64,${buffer.toString("base64")}`)
    .catch(() => null);
  backgroundCache.set(id, promise);
  return promise;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  const secondaryId = url.searchParams.get("b");
  const backgroundParam = url.searchParams.get("bg") ?? SIGNATURE_BACKGROUND_ID;

  if (!isShareCardKind(kind) || !id || !isUuid(id)) {
    return new Response("Bad request", { status: 400 });
  }
  if (secondaryId && !isUuid(secondaryId)) {
    return new Response("Bad request", { status: 400 });
  }
  // Never a caller-supplied URL. `bg` is an allow-listed id and nothing else,
  // so this route can't be pointed at an arbitrary host to fetch on its behalf.
  if (!isShareBackgroundId(backgroundParam)) {
    return new Response("Bad request", { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const data = await loadShareCard(supabase, {
    kind,
    id,
    secondaryId,
    viewerProfileId: profile?.id ?? null,
  });

  // No real data means no card — never a placeholder one.
  if (!data) return new Response("Not found", { status: 404 });

  const [backgroundDataUri, resolvedImages] = await Promise.all([
    loadBackgroundDataUri(
      backgroundParam,
      backgroundParam === OWN_BACKGROUND_ID ? (profile?.background_uploaded_url ?? null) : null,
    ),
    Promise.all(
      shareCardImageUrls(data).map(async (imageUrl) => {
        // Crests and avatars can be app-relative (a KIVO avatar asset) or
        // remote (a provider CDN). Relative ones are read straight off disk
        // rather than fetched back through this server's own HTTP stack.
        if (imageUrl.startsWith("/")) {
          const buffer = await readFile(path.join(process.cwd(), "public", imageUrl)).catch(() => null);
          if (!buffer) return [imageUrl, null] as const;
          const mime = imageUrl.endsWith(".png") ? "image/png" : imageUrl.endsWith(".jpg") || imageUrl.endsWith(".jpeg") ? "image/jpeg" : null;
          // WEBP again: a KIVO avatar is a .webp, and the renderer cannot
          // read one. Those fall back to the initial badge, which is a real
          // design state rather than a hole.
          return [imageUrl, mime ? `data:${mime};base64,${buffer.toString("base64")}` : null] as const;
        }
        return [imageUrl, await fetchImageDataUri(imageUrl)] as const;
      }),
    ),
  ]);

  const imageMap = new Map(resolvedImages);
  const img: ImageResolver = (imageUrl) => (imageUrl ? (imageMap.get(imageUrl) ?? null) : null);

  return new ImageResponse(renderShareCard(data, { backgroundDataUri, img }), {
    width: SHARE_CARD_CANVAS.width,
    height: SHARE_CARD_CANVAS.height,
    headers: {
      // Every card is a snapshot of live rows — a score, a table position, an
      // XP total — and several are scoped to one signed-in viewer. Neither is
      // safe to hold in a shared cache, and a stale scoreline on something
      // people screenshot is the worst version of stale.
      "Cache-Control": "no-store",
    },
  });
}
