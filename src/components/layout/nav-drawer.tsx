"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, type PanInfo } from "motion/react";
import { Menu, Copy, Check, Plus, UsersRound, Search } from "lucide-react";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { isActiveRoute, NAV_ITEMS, type NavItem } from "@/lib/navigation";
import { buildNavGroups } from "@/lib/nav-groups";
import { getViewerNavStats, type ViewerNavStats } from "@/app/(app)/nav-actions";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { AccountSwitcherSheet } from "@/components/auth/account-switcher-sheet";
import type { ViewerProfileSummary } from "./app-shell";

/** Past this much leftward travel (or this much leftward flick), the gesture
 * reads as "put it away" rather than as an accidental drag. Velocity is
 * checked as well as distance so a fast short flick closes too — a distance-
 * only threshold makes a drawer feel heavy. */
const SWIPE_CLOSE_DISTANCE = 72;
const SWIPE_CLOSE_VELOCITY = 420;

function subscribeToNothing() {
  return () => {};
}

/**
 * The mobile navigation drawer, and the app's menu.
 *
 * Founder's call, and the standard platform placement: the hamburger sits
 * top-left where the logo used to, and the menu comes in from the left edge as
 * a full-height drawer over the dimmed page rather than rising from the bottom
 * as a partial sheet. The bottom bar's fifth slot, which used to be this menu,
 * is now Profile.
 *
 * Structure follows the reference the founder supplied: identity first and at
 * full size — avatar, Manage, the handle, the bio, the real follow counts —
 * then a hairline, then titled groups of generously spaced rows with no
 * chevrons, then appearance in its own footer. A full-height drawer is what
 * makes that possible; the old bottom sheet had room for a list and nothing
 * else.
 */
export function NavDrawer({
  aiConfigured,
  isAdmin,
  viewerProfile,
}: {
  aiConfigured: boolean;
  isAdmin: boolean;
  viewerProfile: ViewerProfileSummary | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [stats, setStats] = useState<ViewerNavStats | null>(null);
  // "Are we in the browser yet" as a read of an external fact rather than as
  // state React owns — the same useSyncExternalStore shape (and reasoning) the
  // command palette uses for navigator.platform, with a no-op subscribe since
  // there is nothing to listen for. A useEffect+setState mounted flag would be
  // the derived-state anti-pattern the lint rule correctly rejects.
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Navigating from inside the drawer has to close it, or the panel sits over
  // the page it just navigated to and the app reads as frozen. React's
  // documented "adjust state when a prop changes" pattern — compared during
  // render so the navigation and the close land in the same commit, rather
  // than in an effect that closes it a paint later.
  const [openForPath, setOpenForPath] = useState(pathname);
  if (pathname !== openForPath) {
    setOpenForPath(pathname);
    if (open) setOpen(false);
  }

  const homeItem = NAV_ITEMS.find((item) => item.id === "home");
  const searchItem = NAV_ITEMS.find((item) => item.id === "search");
  // Deliberately the complete set, bottom-bar destinations included. Hiding
  // the four tabs left "Watch" holding one item and "Community" holding one
  // item — group headings over lists of one, which read as a bug — and it made
  // the drawer a different map from the desktop sidebar. A menu is an index of
  // the product; a destination appearing both here and in the tab bar is how
  // every app with both surfaces works.
  // Search is pinned above the groups as an action rather than listed inside
  // Shortcuts, so it is excluded here — otherwise it would appear twice in
  // one panel. NAV_GROUPS itself is untouched: it is the single point of
  // failure that makes /managers and /venues reachable at all, and the way to
  // move one entry is to exclude it at the call site, not to rewrite the map.
  const groups = buildNavGroups({ isAdmin, exclude: ["search"] });

  useFocusTrap(open, panelRef, () => setOpen(false), { restoreFocusRef: triggerRef });

  // Real counts, fetched the first time the drawer is opened and kept for the
  // rest of the session — see getViewerNavStats for why not on every render.
  useEffect(() => {
    if (!open || stats !== null || !viewerProfile) return;
    getViewerNavStats()
      .then((next) => setStats(next))
      .catch(() => {
        // A failed count must not invent one. Leaving `stats` null keeps the
        // row hidden entirely rather than showing a confident zero.
      });
  }, [open, stats, viewerProfile]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x < -SWIPE_CLOSE_DISTANCE || info.velocity.x < -SWIPE_CLOSE_VELOCITY) setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="kivo-focus -ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-surface-2 active:scale-95 lg:hidden"
      >
        <Menu className="h-[22px] w-[22px]" strokeWidth={1.75} />
      </button>

      {/* Portalled to <body>, and this is not optional: the trigger above lives
          inside the top bar, which is `backdrop-blur-xl` — and a
          `backdrop-filter` makes an element a containing block for every
          `position: fixed` descendant. Rendered in place, the overlay's
          `fixed inset-0` resolved against the 52px-tall header instead of the
          viewport, so the panel came out 52px tall with its own contents
          spilling out over the page. The portal is what makes "full height"
          mean the screen.
          
          `AnimatePresence` stays mounted inside the portal rather than the
          portal being conditional on `open`, because unmounting it would take
          the exit animation with it — the drawer would vanish instead of
          sliding back to the edge it came from. */}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
            <div className="fixed inset-0 z-50 lg:hidden">
            {/* Non-focusable backdrop: the panel already has real focusable
                links to tab through, and Escape closes via useFocusTrap, so a
                <button> here would only add an unlabelled first stop in the
                dialog's reading order. Deliberately not fully opaque — the
                page staying visible down the right edge is what makes this
                read as a layer over the app rather than a new screen. */}
            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-overlay backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 460, damping: 44 }}
              drag="x"
              dragDirectionLock
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.9, right: 0 }}
              dragMomentum={false}
              onDragEnd={handleDragEnd}
              // One movement, one meaning: the whole panel travels from the
              // edge it lives on, and nothing inside it fades or scales
              // independently on the way in.
              className="absolute inset-y-0 left-0 flex w-[85vw] max-w-[22rem] touch-pan-y flex-col border-r border-hairline-soft bg-surface-3/95 shadow-float backdrop-blur-2xl"
            >
              {viewerProfile && (
                <IdentityBlock
                  viewer={viewerProfile}
                  stats={stats}
                  onOpenSwitcher={() => {
                    // The drawer goes away as the sheet arrives. Two
                    // simultaneous focus traps fight each other — the drawer's
                    // would pull Tab back out of the sheet — and a sheet
                    // stacked over a drawer over the page is three layers deep
                    // on a phone.
                    setOpen(false);
                    setSwitcherOpen(true);
                  }}
                />
              )}

              <nav
                aria-label="All sections"
                className={cn(
                  "flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4",
                  viewerProfile ? "border-t border-hairline-soft pt-4" : "pt-[calc(env(safe-area-inset-top)+1rem)]",
                )}
              >
                {/* An action, not a destination, and above the groups for the
                    same reason the desktop sidebar puts it there: on a phone
                    there is no ⌘K, so this row is the only deliberate way into
                    search that exists, and it was previously the fourth-from-
                    last row of the last group in a scrolling panel. */}
                {searchItem && (
                  <Link
                    href={searchItem.href}
                    aria-current={isActiveRoute(pathname, searchItem.href) ? "page" : undefined}
                    className="kivo-glass kivo-focus mb-2 flex items-center gap-3 rounded-2xl px-3.5 py-3 transition-colors hover:bg-surface-2"
                  >
                    <Search className="h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={1.75} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">Search KIVO</span>
                      <span className="truncate text-[11px] text-foreground-subtle">
                        Clubs, players, competitions, managers, venues
                      </span>
                    </span>
                  </Link>
                )}

                {homeItem && <DrawerRow item={homeItem} pathname={pathname} aiConfigured={aiConfigured} />}
                {groups.map((group) => (
                  <div key={group.label} className="flex flex-col">
                    <span className="px-3.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                      {group.label}
                    </span>
                    {group.items.map((item) => (
                      <DrawerRow key={item.id} item={item} pathname={pathname} aiConfigured={aiConfigured} />
                    ))}
                  </div>
                ))}
              </nav>

              {/* Appearance gets its own footer rather than a nav row: it is a
                  control, not a destination, and the bottom of a full-height
                  drawer is the easiest place on a phone for a thumb to reach —
                  which is the whole reason it left the top bar. */}
              <div className="flex flex-col gap-2 border-t border-hairline-soft px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                  Appearance
                </span>
                <ThemeToggle className="max-w-none" />
              </div>
            </motion.div>
            </div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* Mounted here, outside the drawer's own AnimatePresence, on purpose:
          opening the switcher closes the drawer, and a sheet rendered inside
          the drawer would be unmounted by that same click. It portals itself. */}
      <AccountSwitcherSheet open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </>
  );
}

/** Identity first, at full size: who you are is the thing you came to this
 * panel to act on, not a 32px row above a list. */
function IdentityBlock({
  viewer,
  stats,
  onOpenSwitcher,
}: {
  viewer: ViewerProfileSummary;
  stats: ViewerNavStats | null;
  onOpenSwitcher: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handle = `@${viewer.username}`;

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  async function copyHandle() {
    try {
      await navigator.clipboard.writeText(handle);
      setCopied(true);
    } catch {
      // Clipboard permission denied (or an insecure origin) — say nothing
      // rather than claim a copy that did not happen.
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
      <div className="flex items-start justify-between gap-3">
        <Link href="/profile" className="kivo-focus relative block shrink-0 rounded-2xl">
          {/* The offset card behind the avatar: depth from one displaced
              surface rather than a shadow, so it holds up in light mode where
              a glow would not. */}
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 h-[68px] w-[68px] rounded-[28%] border border-hairline bg-surface-2"
          />
          <KivoAvatar
            src={viewer.avatarUrl}
            alt=""
            size={68}
            className="relative border border-hairline"
          />
        </Link>

        <Link
          href="/settings"
          className="kivo-glass-sharp kivo-focus shrink-0 rounded-xl px-4 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95"
        >
          Manage
        </Link>
      </div>

      <div className="flex items-center gap-1.5">
        <Link href="/profile" className="kivo-focus min-w-0 rounded-lg">
          <span className="block truncate text-2xl font-semibold tracking-tight text-foreground">{handle}</span>
        </Link>
        <button
          type="button"
          onClick={copyHandle}
          aria-label={copied ? "Handle copied" : `Copy ${handle}`}
          className="kivo-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {copied ? (
            <Check className="h-4 w-4 text-accent" strokeWidth={1.75} />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      </div>

      {viewer.bio ? (
        <p className="line-clamp-3 text-sm text-foreground-muted">{viewer.bio}</p>
      ) : (
        <Link
          href="/settings/account"
          className="kivo-focus flex w-fit items-center gap-1.5 rounded-lg text-sm text-foreground-subtle transition-colors hover:text-foreground-muted"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add a bio
        </Link>
      )}

      {/* Only rendered once the real counts have actually arrived — a stats
          row is worse than no stats row if the numbers in it are guesses. */}
      {stats && (
        <div className="flex items-center gap-2 text-sm">
          <Link href="/profile/following" className="kivo-focus rounded-lg text-foreground-muted transition-colors hover:text-foreground">
            <span className="font-semibold text-foreground">{stats.following}</span> Following
          </Link>
          <span aria-hidden="true" className="text-foreground-subtle">
            ·
          </span>
          {/* Not a link: KIVO has no page that lists who follows you, and a
              control that goes nowhere is worse than plain text. */}
          <span className="text-foreground-muted">
            <span className="font-semibold text-foreground">{stats.followers}</span> Follower
            {stats.followers === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {/* The switcher's home. It belongs in the identity block rather than in
          the nav list below, because it acts on who you are, not on where you
          are going — the same reason Appearance sits in its own footer instead
          of pretending to be a destination. Nothing is fetched until it is
          actually opened. */}
      <button
        type="button"
        onClick={onOpenSwitcher}
        aria-haspopup="dialog"
        className="kivo-focus flex w-full items-center gap-2.5 rounded-xl border border-hairline bg-surface-2/60 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <UsersRound className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1 truncate text-sm font-semibold text-foreground">Switch account</span>
      </button>
    </div>
  );
}

/** One drawer row: leading outline icon, bold label, no chevron — every row
 * here is a navigation, so a per-row chevron is fourteen identical arrows
 * saying nothing. 56px tall, which is a comfortable target and gives the list
 * the air the founder's reference has. */
function DrawerRow({
  item,
  pathname,
  aiConfigured,
}: {
  item: NavItem;
  pathname: string | null;
  aiConfigured: boolean;
}) {
  const active = isActiveRoute(pathname, item.href);
  const Icon = item.icon;
  const isComingSoon = item.status === "coming-soon" && !(item.id === "ai" && aiConfigured);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="kivo-focus group relative flex min-h-14 items-center gap-3.5 rounded-xl px-3.5 transition-colors active:bg-surface-2 focus-visible:ring-inset"
    >
      {active && (
        <motion.span
          aria-hidden="true"
          layoutId="drawer-nav-active"
          className="absolute inset-0 rounded-xl bg-surface-2"
          transition={{ type: "spring", stiffness: 520, damping: 42 }}
        />
      )}
      <Icon
        className={cn(
          "relative h-[19px] w-[19px] shrink-0 transition-colors",
          active ? "text-accent" : "text-foreground-subtle",
        )}
        strokeWidth={1.75}
      />
      <span
        className={cn(
          "relative flex-1 truncate text-[15px] font-semibold",
          active ? "text-foreground" : "text-foreground",
        )}
      >
        {item.label}
      </span>
      {isComingSoon && (
        <span className="relative shrink-0 rounded-full border border-hairline px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Soon
        </span>
      )}
    </Link>
  );
}
