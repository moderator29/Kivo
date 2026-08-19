import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { absoluteUrl } from "@/lib/site-url";
import { listShareBackgrounds } from "@/lib/share-cards/backgrounds";
import { loadShareCard } from "@/lib/share-cards/load";
import { SHARE_CARD_TITLE, type ShareCardKind } from "@/lib/share-cards/types";
import { ShareSheet } from "./share-sheet";

/**
 * The server half of the share sheet, and the only thing a page needs to
 * mount.
 *
 * It does one job the client cannot: **ask whether there is a real card to
 * make at all**. `loadShareCard` returns null whenever the underlying rows
 * would produce a card with invented or missing numbers on it — an unscored
 * fantasy gameweek, a player with nothing synced, a fixture missing a team.
 * When that happens this renders nothing, and the page shows no share
 * affordance. That is the deliberate behaviour: an offer to share something
 * that doesn't exist is worse than no offer, because the user only finds out
 * after they've tapped it.
 *
 * The card data loaded here is then thrown away rather than passed down — the
 * sheet renders the card through `/api/share-card`, which loads it again from
 * the same rows. Two cheap reads, and in exchange the preview is guaranteed
 * to be the same bytes as the download.
 */
export async function ShareCardPanel({
  kind,
  id,
  secondaryId,
  shareUrl,
  shareText,
  heading,
  description,
}: {
  kind: ShareCardKind;
  id: string;
  secondaryId?: string | null;
  /** App-relative path this card was made from, e.g. `/matches/<id>`. */
  shareUrl: string;
  shareText: string;
  heading?: string;
  description?: string;
}) {
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const card = await loadShareCard(supabase, {
    kind,
    id,
    secondaryId,
    viewerProfileId: profile?.id ?? null,
  });
  if (!card) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">{heading ?? SHARE_CARD_TITLE[kind]}</h2>
        {description && <p className="text-xs text-foreground-muted">{description}</p>}
      </div>
      <ShareSheet
        kind={kind}
        id={id}
        secondaryId={secondaryId ?? null}
        title={SHARE_CARD_TITLE[kind]}
        shareUrl={absoluteUrl(shareUrl)}
        shareText={shareText}
        backgrounds={listShareBackgrounds(profile?.background_uploaded_url ?? null)}
        canUpload={Boolean(profile)}
      />
    </section>
  );
}
