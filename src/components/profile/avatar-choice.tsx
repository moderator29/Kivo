"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ImagePlus } from "lucide-react";
import { selectKivoAvatar, uploadAvatar } from "@/app/(app)/settings/avatar-actions";
import { KIVO_AVATAR_IDS, kivoAvatarPath } from "@/lib/kivo-assets";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { ProfileSaveBar } from "@/components/profile/profile-save-bar";

type AvatarChoice =
  | { kind: "kivo"; id: string }
  | { kind: "upload"; file: File | null; previewUrl: string | null };

/**
 * The whole avatar decision on one page: your own photo, or one of KIVO's.
 *
 * Nothing is written until Save. Picking a file previews it locally through an
 * object URL and uploads only on submit — so choosing a photo, looking at it,
 * and changing your mind costs nothing, where the old inline picker uploaded
 * to Storage the instant the file dialog closed.
 *
 * Both upload rows are ordinary file inputs. `capture="environment"` on the
 * first is what makes iOS and Android open the camera directly rather than the
 * photo library; desktop browsers ignore it and show the same file dialog as
 * the second row, which is why the labels describe the intent rather than
 * promising a camera that a laptop does not have.
 *
 * The uploaded avatar is reused rather than re-fetched: `uploadAvatar` writes
 * to the `avatars` bucket that Settings has used since migration 0043, with
 * the same validation and the same folder-per-user RLS shape. There is exactly
 * one avatar upload path in this product.
 */
export function AvatarChoice({
  avatarType,
  avatarKivoId,
  currentSrc,
}: {
  avatarType: "kivo" | "uploaded";
  avatarKivoId: string | null;
  currentSrc: string | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<AvatarChoice>(
    avatarType === "kivo" && avatarKivoId
      ? { kind: "kivo", id: avatarKivoId }
      : { kind: "upload", file: null, previewUrl: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  // Held separately from `choice` so the cleanup effect can revoke the
  // previous URL when a second file is picked, without the effect having to
  // reach into a union type.
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    setError(null);
    setSaved(false);
    setChoice({ kind: "upload", file, previewUrl: url });
  }

  const previewSrc =
    choice.kind === "kivo"
      ? kivoAvatarPath(choice.id as (typeof KIVO_AVATAR_IDS)[number])
      : (choice.previewUrl ?? currentSrc);

  const unchanged =
    choice.kind === "kivo"
      ? avatarType === "kivo" && choice.id === avatarKivoId
      : choice.file === null;

  return (
    <form
      className="flex flex-col gap-6"
      action={() => {
        setError(null);
        startTransition(async () => {
          if (choice.kind === "kivo") {
            const result = await selectKivoAvatar(choice.id);
            if (result.error) {
              setError(result.error);
              return;
            }
          } else {
            if (!choice.file) return;
            const formData = new FormData();
            formData.set("avatar", choice.file);
            const result = await uploadAvatar(formData);
            if (result.error) {
              setError(result.error);
              return;
            }
          }
          setSaved(true);
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col items-center gap-3">
        <span className="rounded-full bg-background p-1 ring-1 ring-hairline-soft">
          <KivoAvatar src={previewSrc} size={116} />
        </span>
        <p className="text-xs text-foreground-subtle">
          {choice.kind === "upload" && choice.file ? "Your new photo — not saved yet" : "Your avatar"}
        </p>
      </div>

      <input
        ref={cameraInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        capture="environment"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      <div className="kivo-glass flex flex-col divide-y divide-hairline-soft overflow-hidden rounded-2xl">
        <ActionRow
          icon={<Camera className="h-4.5 w-4.5" strokeWidth={1.75} />}
          label="Take a photo"
          onClick={() => cameraInput.current?.click()}
        />
        <ActionRow
          icon={<ImagePlus className="h-4.5 w-4.5" strokeWidth={1.75} />}
          label="Choose from your photos"
          onClick={() => libraryInput.current?.click()}
        />
      </div>
      <p className="-mt-4 px-1 text-[11px] text-foreground-subtle">PNG, JPEG, WEBP or GIF, up to 5MB.</p>

      <div className="flex flex-col gap-3">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Or pick a KIVO avatar
        </h2>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
          {KIVO_AVATAR_IDS.map((id) => {
            const isActive = choice.kind === "kivo" && choice.id === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setChoice({ kind: "kivo", id });
                  setSaved(false);
                  setError(null);
                }}
                aria-label="Choose this KIVO avatar"
                aria-pressed={isActive}
                className="kivo-focus group relative flex items-center justify-center"
              >
                <span
                  className={`rounded-full p-1 transition ${
                    isActive ? "bg-accent" : "bg-transparent group-hover:bg-hairline-strong"
                  }`}
                >
                  <KivoAvatar src={kivoAvatarPath(id)} size={80} />
                </span>
                {isActive && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent ring-2 ring-background">
                    <Check className="h-3.5 w-3.5 text-on-accent" strokeWidth={2} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ProfileSaveBar pending={pending} disabled={unchanged} saved={saved} error={error} label="Save avatar" />
    </form>
  );
}

function ActionRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="kivo-focus flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-1"
    >
      <span className="text-foreground-muted">{icon}</span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </button>
  );
}
