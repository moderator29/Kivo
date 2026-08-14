import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { getRecentNotifications } from "@/lib/notifications";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";

export async function TopBar() {
  const { notifications, unreadCount } = await getRecentNotifications();

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-kivo-obsidian/90 px-4 py-3 backdrop-blur-lg lg:px-8">
      <Link href="/home" className="flex items-center gap-2 lg:hidden">
        <span className="kivo-gradient-prime h-6 w-6 rounded-lg" aria-hidden />
        <span className="text-base font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>

      <div className="ml-auto flex flex-1 items-center gap-3 lg:ml-0">
        <CommandPalette />
      </div>

      <NotificationBell initialNotifications={notifications} initialUnreadCount={unreadCount} />
      <UserButton />
    </header>
  );
}
