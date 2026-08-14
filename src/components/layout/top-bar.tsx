import Link from "next/link";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import { getRecentNotifications } from "@/lib/notifications";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";
import kivoLogo from "../../../public/brand/kivo-logo.png";

export async function TopBar({ signedIn }: { signedIn: boolean }) {
  const { notifications, unreadCount } = signedIn
    ? await getRecentNotifications()
    : { notifications: [], unreadCount: 0 };

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-kivo-obsidian/90 px-4 py-3 backdrop-blur-lg lg:px-8">
      <Link href="/home" className="flex items-center gap-2 lg:hidden">
        <Image src={kivoLogo} alt="" width={32} height={32} className="h-8 w-8 shrink-0" priority />
        <span className="text-base font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>

      <div className="ml-auto flex flex-1 items-center gap-3 lg:ml-0">
        <CommandPalette />
      </div>

      {signedIn ? (
        <>
          <NotificationBell initialNotifications={notifications} initialUnreadCount={unreadCount} />
          <UserButton />
        </>
      ) : (
        <Link
          href="/sign-up"
          className="kivo-gradient-prime shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
        >
          Sign up
        </Link>
      )}
    </header>
  );
}
