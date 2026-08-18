"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Camera, Check, ImagePlus, Trash2 } from "lucide-react";
import { selectBackground, clearBackground, uploadBackground } from "@/app/(app)/profile/background-actions";
import { KIVO_BACKGROUND_IDS, kivoBackgroundPath } from "@/lib/kivo-assets";
import { ProfileCover } from "@/components/profile/profile-cover";
import { ProfileSaveBar } from "@/components/profile/profile-save-bar";

type CoverChoice =
  | { kind: "none" }
  | { kind: "kivo"; id: string }
  | { kind: "upload"; file: File | null; previewUrl: string | null };

/**
 * The cover picker, as its own screen.
 *
 * What it replaces: ten covers as a 5-across strip of thumbnails roughly 60px
 * wide, wedged into the middle of the profile, each one a smear of colour you
 * could not actually judge — and no way to use your own image at all. Here the
 * options are two-up on a phone and three-up above it, at the aspect ratio
 * they are actually shown in, with the live preview of the current choice
 * sitting above them.
 *
 * "No background" is a first-class option rather than a Remove link that only
 * appears once one is set: not having a cover is a real, common and permanent
 * state — KIVO never assigns a default — so it belongs in the grid as
 * something you can choose, not as an undo.
 */
export function BackgroundChoice({
  backgroundId,
  backgroundUploadedUrl,
}: {
  backgroundId: string | null;
  backgroundUploadedUrl: string | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<CoverChoice>(
    backgroundUploadedUrl
      ? { kind: "upload", file: null, previewUrl: backgroundUploadedUrl }
      : backgroundId
        ? { kind: "kivo", id: backgroundId }
        : { kind: "none" },
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
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

  function pick(next: CoverChoice) {
    setChoice(next);
    setError(null);
    setSaved(false);
  }

  const previewSrc =
    choice.kind === "none"
      ? null
      : choice.kind === "kivo"
        ? kivoBackgroundPath(choice.id as (typeof KIVO_BACKGROUND_IDS)[number])
        : choice.previewUrl;

  const unchanged =
    choice.kind === "none"
      ? backgroundId === null && backgroundUploadedUrl === null
      : choice.kind === "kivo"
        ? choice.id === backgroundId
        : choice.file === null;

  return (
    <form
      className="flex flex-col gap-6"
      action={() => {
        setError(null);
        startTransition(async () => {
          let result: { error: string | null };
          if (choice.kind === "none") {
            result = await clearBackground();
          } else if (choice.kind === "kivo") {
            result = await selectBackground(choice.id);
          } else {
            if (!choice.file) return;
            const formData = new FormData();
            formData.set("background", choice.file);
            result = await uploadBackground(formData);
          }
          if (result.error) {
            setError(result.error);
            return;
          }
          setSaved(true);
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="kivo-glass overflow-hidden rounded-2xl">
          <ProfileCover src={previewSrc} className="aspect-[16/9] w-full" sizes="(min-width: 512px) 512px, 100vw" />
        </div>
        <p className="px-1 text-center text-[11px] text-foreground-subtle">
          {choice.kind === "upload" && choice.file ? "Your new cover — not saved yet" : "How your cover looks"}
        </p>
      </div>

      <input
        ref={cameraInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
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
        {choice.kind !== "none" && (
          <ActionRow
            icon={<Trash2 className="h-4.5 w-4.5" strokeWidth={1.75} />}
            label="Use no background"
            onClick={() => pick({ kind: "none" })}
          />
        )}
      </div>
      <p className="-mt-4 px-1 text-[11px] text-foreground-subtle">PNG, JPEG or WEBP, up to 5MB. Wide images work best.</p>

      <div className="flex flex-col gap-3">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Or pick a KIVO background
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {KIVO_BACKGROUND_IDS.map((id) => {
            const isActive = choice.kind === "kivo" && choice.id === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => pick({ kind: "kivo", id })}
                aria-label="Choose this KIVO background"
                aria-pressed={isActive}
                className={`kivo-focus relative aspect-[16/10] overflow-hidden rounded-2xl ring-2 transition ${
                  isActive ? "ring-accent" : "ring-transparent hover:ring-hairline-strong"
                }`}
              >
                <Image
                  src={kivoBackgroundPath(id)}
                  alt=""
                  fill
                  loading="lazy"
                  sizes="(min-width: 512px) 170px, 45vw"
                  className="object-cover"
                />
                {isActive && (
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent shadow-soft">
                    <Check className="h-3.5 w-3.5 text-on-accent" strokeWidth={2} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ProfileSaveBar pending={pending} disabled={unchanged} saved={saved} error={error} label="Save background" />
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
