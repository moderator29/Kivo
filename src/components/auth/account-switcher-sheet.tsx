"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, LogOut, Mail, Plus, UsersRound, X } from "lucide-react";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { ViewportPortal } from "@/components/ui/viewport-portal";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  beginAddAccount,
  getAccountSwitcherState,
  signOutStoredAccount,
  switchToStoredAccount,
  type AccountSwitcherState,
} from "@/app/(app)/account-switcher-actions";

/**
 * "Your accounts" — the multi-account switcher, as a bottom sheet.
 *
 * ## Where the structure comes from, and what was deliberately not taken
 *
 * The founder supplied a pump.fun screenshot as the structural reference, and
 * the structure is followed closely: a bottom sheet titled "Your accounts" with
 * a circular close button top-right; the active account in its own card with an
 * accent border, a large rounded-square avatar carrying a small provider badge
 * on its corner, an edit pill top-right, then name / secondary identifier /
 * email stacked, with a value right-aligned; a centred "Other accounts" divider
 * with hairlines either side; each other account as a full-width row with
 * avatar, name, secondary identifier, a right-aligned value and a circular
 * icon button; and a full-width pill button pinned at the bottom.
 *
 * Two things from the reference are deliberately NOT here:
 *
 *  - **The numbers.** Their rows show wallet balances. KIVO has no money and
 *    will not put an invented figure in the place a balance sat. The
 *    right-aligned value is XP, which is a real total read from the XP ledger
 *    for that specific account. When it cannot be read, the slot renders
 *    nothing at all — never a zero, which would be a fabricated number wearing
 *    a real number's clothes. A genuine zero does render, because zero XP is a
 *    fact.
 *
 *  - **The pencil.** In the reference, each inactive row carries a circular
 *    pencil that edits that account. KIVO cannot edit an account it is not
 *    signed in as — every profile write goes through that account's own
 *    session and RLS — so a pencil there would be a control that either does
 *    nothing or silently switches accounts first. The circular button is kept
 *    (it is load-bearing to the row's rhythm) and given the action that surface
 *    genuinely owns: signing that stored account out, for real. Editing lives
 *    where it already lives — the "Edit profile" pill on the active card links
 *    to /profile/edit, the page a sibling built for exactly this.
 *
 * ## Why the data is fetched on open
 *
 * Listing stored accounts costs a verified Supabase round trip each, and can
 * rotate a refresh token that then has to be written back to a cookie — which
 * only a Server Action can do. So the sheet holds no server-rendered account
 * data at all: it opens, calls `getAccountSwitcherState`, and shows skeletons
 * until real values arrive. Nothing is rendered from a guess in the meantime.
 */

export function AccountSwitcherSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  const [state, setState] = useState<AccountSwitcherState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Which slot has an action in flight, so one row can show a spinner without
   *  the whole sheet going busy. */
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  useFocusTrap(open, panelRef, onClose);

  // Every setState here lives inside an async callback rather than in the
  // effect body below — a synchronous setState in an effect is the cascading
  // render this codebase's lint rules reject, and the rule is right.
  const load = useCallback(() => {
    return getAccountSwitcherState()
      .then((result) => {
        if ("unavailable" in result) {
          setState(null);
          setLoadFailed(true);
          return;
        }
        setLoadFailed(false);
        setState(result);
      })
      .catch(() => {
        // No invented fallback list. The sheet says it couldn't read the
        // accounts and offers a retry, which is the truth.
        setLoadFailed(true);
      });
  }, []);

  // A stale error from the last time this was open must not greet the next
  // opening. Compared during render — React's documented "adjust state when a
  // prop changes" pattern, the same one NavDrawer uses to close itself on
  // navigation — rather than an effect, so the reset lands in the same commit
  // as the open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setActionError(null);
  }

  // Re-read every time it opens rather than once: an account can be signed out
  // from another device between two openings, and a stale row that fails when
  // tapped is worse than a second of skeleton.
  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function handleSwitch(slot: number) {
    setActionError(null);
    setBusySlot(slot);
    startTransition(async () => {
      // Only returns on failure — success redirects out of this page entirely,
      // after revalidating the whole tree.
      const result = await switchToStoredAccount(slot);
      setBusySlot(null);
      if (result?.error) {
        setActionError(result.error);
        load();
      }
    });
  }

  function handleSignOut(slot: number) {
    setActionError(null);
    setBusySlot(slot);
    startTransition(async () => {
      const result = await signOutStoredAccount(slot);
      setBusySlot(null);
      if (result.error) {
        setActionError(result.error);
        return;
      }
      load();
    });
  }

  function handleAdd() {
    setActionError(null);
    startTransition(async () => {
      const result = await beginAddAccount();
      if (result?.error) setActionError(result.error);
    });
  }

  // Portalled to <body>. Not optional: the drawer and the profile hub that open
  // this both sit inside an animating `motion.div`, and a transformed ancestor
  // becomes the containing block for `position: fixed` — so "fixed inset-0"
  // declared in place would resolve against the page body, not the viewport.
  return (
    <ViewportPortal>
      <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex flex-col justify-end"
        >
          {/* Non-focusable backdrop, same reasoning as every other KIVO sheet:
              the panel's own labelled ✕ is the announced close control, so a
              <button> here would only add an unlabelled first tab stop inside
              the dialog. Escape closes via useFocusTrap. */}
          <div aria-hidden="true" className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Your accounts"
            initial={{ y: 32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="kivo-popover relative z-10 mx-3 mb-[calc(env(safe-area-inset-bottom)+12px)] flex max-h-[86vh] flex-col rounded-3xl px-4 pb-4 pt-2.5 sm:mx-auto sm:w-full sm:max-w-md"
          >
            <div aria-hidden="true" className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-hairline-strong" />

            <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Your accounts</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="kivo-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground-subtle transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {loadFailed ? (
                <LoadFailed onRetry={load} />
              ) : !state ? (
                <SheetSkeleton />
              ) : (
                <>
                  <ActiveAccountCard account={state.active} />

                  {state.others.length > 0 && (
                    <>
                      <Divider label="Other accounts" />
                      <ul className="flex flex-col">
                        {state.others.map((account) => (
                          <li key={account.slot}>
                            <StoredAccountRow
                              account={account}
                              busy={busySlot === account.slot && pending}
                              disabled={pending}
                              onSwitch={() => handleSwitch(account.slot)}
                              onSignOut={() => handleSignOut(account.slot)}
                            />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}

              {actionError && (
                <p role="alert" className="px-1 text-center text-xs text-critical">
                  {actionError}
                </p>
              )}
            </div>

            <div className="shrink-0 pt-3">
              {state && !state.canAddAccount ? (
                <p className="rounded-2xl border border-hairline bg-surface-inset px-4 py-3 text-center text-xs text-foreground-subtle">
                  You can keep {state.maxAccounts} accounts signed in on this device. Sign one out to add another.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={pending || !state}
                  className="kivo-focus flex w-full items-center justify-center gap-2 rounded-full border border-hairline bg-surface-2 px-6 py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  Add account
                </button>
              )}
              {/* The security property this sheet has, said out loud rather than
                  left for someone to discover. Anyone holding this phone can tap
                  a stored account and be in it — that is what a switcher is —
                  and the honest response is to say so next to the control that
                  undoes it, not to hide it.
                  
                  Only shown once there is actually something stored: stating a
                  policy about stored accounts to somebody who has none is noise,
                  and the line means nothing until it applies to them. */}
              {state && state.others.length > 0 && (
                <p className="pt-2.5 text-center text-[11px] leading-relaxed text-foreground-subtle">
                  Stored accounts stay signed in until you sign them out.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </ViewportPortal>
  );
}

/** The active account: its own card, an accent border, and the only place in
 *  the sheet that carries an edit affordance. */
function ActiveAccountCard({ account }: { account: AccountSwitcherState["active"] }) {
  const handle = account.username ? `@${account.username}` : null;
  const name = account.displayName || handle || account.email || "Your account";

  return (
    <div className="rounded-2xl border border-accent/60 bg-surface-inset p-3.5">
      <div className="flex items-start justify-between gap-3">
        <span className="relative shrink-0">
          <KivoAvatar
            src={account.avatarSrc}
            name={name}
            size={64}
            radiusClassName="rounded-2xl"
            className="border border-hairline"
          />
          {/* The provider badge in the reference is Google. KIVO has no social
              login and no passwords — every account here signed in with an
              emailed code — so the badge says email, which is the true answer
              to the question it is asking. */}
          <span
            title="Signed in with an email code"
            className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-hairline bg-surface-3 text-foreground-muted"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Signed in with an email code</span>
          </span>
        </span>

        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">
            <Check className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            Active
          </span>
          <Link
            href="/profile/edit"
            className="kivo-glass-sharp kivo-focus rounded-full px-3.5 py-2 text-xs font-semibold text-foreground transition-transform active:scale-95"
          >
            Edit profile
          </Link>
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 pt-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold tracking-tight text-foreground">{name}</p>
          {handle && name !== handle ? (
            <p className="truncate text-sm text-foreground-muted">{handle}</p>
          ) : null}
          {account.email ? <p className="truncate pt-0.5 text-xs text-foreground-subtle">{account.email}</p> : null}
        </div>
        <XpValue xp={account.xp} />
      </div>
    </div>
  );
}

/** One stored account. The row itself switches; the circular button signs out. */
function StoredAccountRow({
  account,
  busy,
  disabled,
  onSwitch,
  onSignOut,
}: {
  account: AccountSwitcherState["others"][number];
  busy: boolean;
  disabled: boolean;
  onSwitch: () => void;
  onSignOut: () => void;
}) {
  const handle = account.username ? `@${account.username}` : null;
  const name = account.displayName || handle || account.email || "KIVO account";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onSwitch}
        disabled={disabled}
        className="kivo-focus flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1.5 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="relative shrink-0">
          <KivoAvatar
            src={account.avatarSrc}
            name={name}
            size={44}
            radiusClassName="rounded-xl"
            className="border border-hairline"
          />
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-overlay">
              <Loader2 className="h-4 w-4 animate-spin text-foreground" strokeWidth={1.75} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
          <span className="block truncate text-xs text-foreground-subtle">
            {handle && name !== handle ? handle : (account.email ?? "No profile yet")}
          </span>
        </span>
        <XpValue xp={account.xp} compact />
        <span className="sr-only">Switch to this account</span>
      </button>

      <button
        type="button"
        onClick={onSignOut}
        disabled={disabled}
        aria-label={`Sign out ${handle ?? name}`}
        className="kivo-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground-subtle transition-colors hover:text-critical disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The right-aligned value, where the reference has a wallet balance.
 *
 * `null` renders nothing — not "0 XP", not a dash that looks like a value. A
 * real zero renders as "0 XP", because that is a fact about that account.
 */
function XpValue({ xp, compact = false }: { xp: number | null; compact?: boolean }) {
  if (xp === null) return null;
  return (
    <span className={cn("shrink-0 text-right", compact ? "text-xs" : "text-sm")}>
      <span className="font-semibold text-foreground">{formatNumber(xp)}</span>{" "}
      <span className="text-foreground-subtle">XP</span>
    </span>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="h-[132px] animate-pulse rounded-2xl border border-hairline bg-surface-2" />
      <div className="h-14 animate-pulse rounded-2xl bg-surface-2" />
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-hairline bg-surface-inset px-4 py-8 text-center">
      <p className="text-sm text-foreground-muted">Your accounts couldn&apos;t be loaded.</p>
      <button
        type="button"
        onClick={onRetry}
        className="kivo-focus rounded-full border border-hairline px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface-2"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * A self-contained "Accounts" row plus the sheet it opens, for surfaces that
 * are Server Components and only want to drop one element in (the profile edit
 * hub). Entry points that already own client state — the nav drawer — render
 * `AccountSwitcherSheet` directly instead.
 */
export function AccountSwitcherLaunchRow({ label = "Switch account" }: { label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Matches SettingRow's metrics exactly so it sits in a SettingRowGroup
          without looking bolted on — but deliberately without SettingRow's
          trailing chevron, because this opens a sheet in place rather than
          navigating to a page, and a chevron promises the latter. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="kivo-focus flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-1"
      >
        <UsersRound className="h-4 w-4 shrink-0 text-foreground-muted" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </button>
      <AccountSwitcherSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
