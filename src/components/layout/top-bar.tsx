import Link from "next/link";
import { Search } from "lucide-react";
import { UserButton } from "@clerk/nextjs";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-kivo-obsidian/90 px-4 py-3 backdrop-blur-lg lg:px-8">
      <Link href="/home" className="flex items-center gap-2 lg:hidden">
        <span className="kivo-gradient-prime h-6 w-6 rounded-lg" aria-hidden />
        <span className="text-base font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>

      <div className="ml-auto flex flex-1 items-center gap-3 lg:ml-0">
        <label className="kivo-glass flex w-full max-w-md items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground-muted">
          <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <input
            type="search"
            placeholder="Search teams, players, competitions…"
            className="w-full bg-transparent text-foreground placeholder:text-foreground-subtle focus:outline-none"
          />
        </label>
      </div>

      <UserButton />
    </header>
  );
}
