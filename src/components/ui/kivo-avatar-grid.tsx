"use client";

import { Check } from "lucide-react";
import { KIVO_AVATAR_DESCRIPTIONS, KIVO_AVATAR_IDS, type KivoAvatarId, kivoAvatarPath } from "@/lib/kivo-assets";
import { AVATAR_RADIUS_CLASS, KivoAvatar } from "@/components/ui/kivo-avatar";

/**
 * The KIVO avatar picker grid — every one of the 18 designs, each shown whole
 * and large enough to choose from. Shared by both pickers (`/profile/avatar`
 * and `/settings/avatar`) so the two cannot drift apart again.
 *
 * The thing this grid is answering: you cannot pick a face you cannot see.
 * The version it replaces offered five options at 56–80px, each one centre-
 * cropped by `object-cover` into a slice of a full-body poster — in practice a
 * square of shirt. So three rules here, and all three are the design:
 *
 *  1. **Every option is the whole artwork.** Square tile, square source, no
 *     crop, rendered through the same `KivoAvatar` every other surface in the
 *     app uses, so the tile is a truthful preview of what you are choosing.
 *  2. **Three across on a phone.** At a 390px viewport that is a ~106px tile —
 *     roughly three times the area of the old one, and the smallest size at
 *     which these designs are actually distinguishable from each other.
 *  3. **Selection is never colour alone.** The chosen tile gets an accent
 *     ring, a filled check badge, `aria-pressed`, and the word "Selected"
 *     underneath. Any one of those is enough on its own.
 *
 * Each option's accessible name is a description of its artwork
 * (`KIVO_AVATAR_DESCRIPTIONS`), never its number — eighteen buttons all called
 * "Choose this KIVO avatar" would be a list of identical rows to a screen
 * reader, and an id in a label would leak an internal asset number into the UI.
 */
export function KivoAvatarGrid({
  selectedId,
  onSelect,
  disabled = false,
  pendingId = null,
}: {
  selectedId: string | null;
  onSelect: (id: KivoAvatarId) => void;
  disabled?: boolean;
  /** Id currently being written to the server, if the caller saves on tap. */
  pendingId?: string | null;
}) {
  return (
    <ul className="grid list-none grid-cols-3 gap-3 p-0 sm:grid-cols-6">
      {KIVO_AVATAR_IDS.map((id) => {
        const isSelected = selectedId === id;
        const isPending = pendingId === id;
        return (
          <li key={id} className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(id)}
              aria-pressed={isSelected}
              aria-label={KIVO_AVATAR_DESCRIPTIONS[id]}
              className={`kivo-focus relative block w-full transition disabled:opacity-60 ${AVATAR_RADIUS_CLASS} ${
                isSelected
                  ? "ring-2 ring-accent ring-offset-2 ring-offset-background"
                  : "ring-1 ring-hairline hover:ring-hairline-strong"
              }`}
            >
              {/* The tile's size comes from the grid, not from the caller, so
                  the avatar fills it — and it is still the same KivoAvatar
                  every other surface draws, which is what makes this tile a
                  truthful preview rather than a lookalike. */}
              <span className={`relative block aspect-square w-full overflow-hidden ${AVATAR_RADIUS_CLASS}`}>
                <KivoAvatar src={kivoAvatarPath(id)} alt="" fill radiusClassName="" />
              </span>
              {isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent ring-2 ring-background"
                >
                  <Check className="h-3.5 w-3.5 text-on-accent" strokeWidth={2} />
                </span>
              )}
              {isPending && (
                <span className={`absolute inset-0 flex items-center justify-center bg-overlay ${AVATAR_RADIUS_CLASS}`}>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                </span>
              )}
            </button>
            {/* The fourth, non-colour signal for the selected tile. It holds a
                blank line's worth of space when nothing is selected so that
                choosing an avatar does not reflow the grid under your thumb. */}
            <span
              aria-hidden="true"
              className={`text-[10px] font-semibold uppercase tracking-wide ${
                isSelected ? "text-accent" : "text-transparent"
              }`}
            >
              Selected
            </span>
          </li>
        );
      })}
    </ul>
  );
}
