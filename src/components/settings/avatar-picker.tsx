"use client";

import { useRef, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Upload } from "lucide-react";
import { selectKivoAvatar, uploadAvatar } from "@/app/(app)/settings/avatar-actions";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { KivoAvatarGrid } from "@/components/ui/kivo-avatar-grid";

type AvatarProfile = {
  avatar_type: "kivo" | "uploaded";
  avatar_kivo_id: string | null;
  avatar_uploaded_url: string | null;
  avatar_url: string | null;
};

/**
 * Settings' copy of the avatar decision. It saves on tap where
 * `/profile/avatar` saves on a Save button, which is the one real difference
 * between the two screens — the options themselves come from the shared
 * `KivoAvatarGrid`, so all 18 designs render identically on both, and neither
 * screen can drift into its own idea of what an avatar looks like.
 */
export function AvatarPicker({ profile }: { profile: AvatarProfile }) {
  const [current, setCurrent] = useState(profile);
  const [pending, startTransition] = useTransition();
  const [pendingKivoId, setPendingKivoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSrc = resolveAvatarSrc(current);

  function flashSaved() {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1600);
  }

  function handleSelectKivo(kivoId: string) {
    setError(null);
    setPendingKivoId(kivoId);
    startTransition(async () => {
      const result = await selectKivoAvatar(kivoId);
      setPendingKivoId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCurrent({ avatar_type: "kivo", avatar_kivo_id: kivoId, avatar_uploaded_url: null, avatar_url: current.avatar_url });
      flashSaved();
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.set("avatar", file);
    startTransition(async () => {
      const result = await uploadAvatar(formData);
      if (result.error) {
        setError(result.error);
      } else {
        // Server action reads the freshly-set row on next render via
        // revalidatePath; the local optimistic preview here just needs
        // *some* URL to show immediately, and a fresh object URL for the
        // just-picked file is exactly what the server now has stored too.
        setCurrent({ avatar_type: "uploaded", avatar_kivo_id: null, avatar_uploaded_url: URL.createObjectURL(file), avatar_url: current.avatar_url });
        flashSaved();
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <KivoAvatar src={activeSrc} size={56} />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">Your avatar</span>
          <span className="text-xs text-foreground-subtle">
            {current.avatar_type === "uploaded" ? "Your own photo" : "A KIVO avatar"}
          </span>
        </div>
        <AnimatePresence>
          {justSaved && (
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="ml-auto flex items-center gap-1 text-xs font-medium text-live"
            >
              <Check className="h-3 w-3" strokeWidth={2} />
              Saved
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <KivoAvatarGrid
        selectedId={current.avatar_type === "kivo" ? current.avatar_kivo_id : null}
        onSelect={handleSelectKivo}
        disabled={pending}
        pendingId={pendingKivoId}
      />

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFileChange}
          className="hidden"
          id="avatar-upload-input"
        />
        <label
          htmlFor="avatar-upload-input"
          aria-disabled={pending}
          className="kivo-glass-sharp flex w-fit cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95 aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={2} />
          Upload your own photo
        </label>
        <span className="text-[11px] text-foreground-subtle">PNG, JPEG, WEBP or GIF, up to 5MB.</span>
      </div>

      {error && (
        <span className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </span>
      )}
    </div>
  );
}
