import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { Bell } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { getRecentNotifications } from "@/lib/notifications";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";
import { PreviewModeToggle } from "@/components/admin/preview-mode-toggle";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

/**
 * Static stand-in for the notification bell while its data streams in below —
 * same box size and icon as the real button's closed state, so nothing shifts
 * when it's replaced; the only visible change on resolve is the unread badge
 * (if any) popping in, same as any other "streams in when ready" affordance
 * elsewhere in the app.
 */
function NotificationBellFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted"
    >
      <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </div>
  );
}

/**
 * The actual data fetch, isolated in its own async Server Component so it can
 * be wrapped in <Suspense> below — a Suspense boundary only suspends on an
 * async component within it, not on an await in its parent.
 */
async function NotificationBellData() {
  const { notifications, unreadCount } = await getRecentNotifications();
  return <NotificationBell initialNotifications={notifications} initialUnreadCount={unreadCount} />;
}

export function TopBar({
  signedIn,
  isAdmin = false,
  previewMode = false,
}: {
  signedIn: boolean;
  /** Gates the preview-mode toggle — see src/lib/preview-mode.ts. A guest or
   * non-admin never sees this control at all, not even in its "off" state. */
  isAdmin?: boolean;
  previewMode?: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-kivo-obsidian/90 px-4 py-3 backdrop-blur-lg lg:px-8">
      <Link
        href="/home"
        className="flex items-center gap-2 rounded-lg lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
      >
        <Image src={kivoLogo} alt="" width={32} height={32} className="h-8 w-8 shrink-0" priority />
        <span className="text-base font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>

      <div className="ml-auto flex min-w-0 flex-1 items-center gap-3 lg:ml-0">
        <CommandPalette />
      </div>

      {isAdmin && <PreviewModeToggle active={previewMode} />}

      {signedIn ? (
        <>
          <Suspense fallback={<NotificationBellFallback />}>
            <NotificationBellData />
          </Suspense>
          <UserButton />
        </>
      ) : (
        <Link
          href="/sign-up"
          className="kivo-gradient-prime shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
        >
          Sign up
        </Link>
      )}
    </header>
  );
}
