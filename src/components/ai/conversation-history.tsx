"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { History, Pencil, Trash2, Check, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { ConversationSummary } from "@/app/(app)/ai/actions";

function displayTitle(conversation: ConversationSummary): string {
  return conversation.title?.trim() || "New conversation";
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<{ error: string | null }>;
  onDelete: () => Promise<{ error: string | null }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayTitle(conversation));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timeout = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(timeout);
  }, [confirmingDelete]);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(displayTitle(conversation));
    setRowError(null);
    setEditing(true);
  }

  function submitRename() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false);
      return;
    }
    setEditing(false);
    startTransition(async () => {
      const result = await onRename(trimmed);
      if (result.error) setRowError(result.error);
    });
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    startTransition(async () => {
      const result = await onDelete();
      if (result.error) {
        setRowError(result.error);
        setConfirmingDelete(false);
      }
    });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !editing && onSelect()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !editing) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex w-full items-center gap-2 border-b border-hairline-soft px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
        active && "bg-accent-soft",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          active ? "kivo-gradient-prime" : "bg-surface-2",
        )}
      >
        <MessageSquare className={cn("h-3.5 w-3.5", active ? "text-on-accent" : "text-foreground-subtle")} strokeWidth={1.75} />
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            onBlur={submitRename}
            maxLength={80}
            className="w-full rounded-md border border-hairline bg-surface-inset px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        ) : (
          <p className={cn("truncate text-sm", active ? "font-medium text-foreground" : "text-foreground-muted")}>
            {displayTitle(conversation)}
          </p>
        )}
        <RelativeTime iso={conversation.updated_at} className="mt-0.5 block text-xs text-foreground-subtle" />
        {rowError && (
          <p className="mt-0.5 text-xs text-critical" role="status" aria-live="polite">
            {rowError}
          </p>
        )}
      </div>

      <div className={cn("flex shrink-0 items-center gap-1 transition-opacity", confirmingDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            disabled={pending}
            aria-busy={pending}
            aria-label="Rename conversation"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={pending}
          aria-busy={pending}
          aria-label={confirmingDelete ? "Confirm delete conversation" : "Delete conversation"}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            confirmingDelete
              ? "bg-critical/15 text-critical hover:bg-critical/25"
              : "text-foreground-subtle hover:bg-surface-2 hover:text-critical",
          )}
        >
          {confirmingDelete ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}

export function ConversationHistoryPanel({
  conversations,
  activeConversationId,
  onSelect,
  onRename,
  onDelete,
}: {
  conversations: ConversationSummary[];
  activeConversationId: string | undefined;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<{ error: string | null }>;
  onDelete: (id: string) => Promise<{ error: string | null }>;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(open, dropdownRef, () => setOpen(false), { restoreFocusRef: toggleButtonRef });

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={panelRef} className="relative">
      <motion.button
        ref={toggleButtonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Conversation history"
        aria-expanded={open}
        aria-haspopup="dialog"
        whileTap={{ scale: 0.92 }}
        className={cn(
          "kivo-glass-sharp flex h-10 w-10 items-center justify-center rounded-full text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          open && "text-foreground",
        )}
      >
        <History className="h-4 w-4" strokeWidth={1.75} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={dropdownRef}
            role="dialog"
            aria-label="Conversation history"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className="kivo-glass-brand fixed left-4 right-4 top-16 z-30 max-h-[70vh] overflow-hidden rounded-2xl sm:absolute sm:left-0 sm:right-auto sm:top-11 sm:max-h-none sm:w-80"
          >
            <div className="flex items-center justify-between border-b border-hairline-soft px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Conversation history</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {conversations.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-foreground-muted">
                  No past conversations yet. Start chatting and they&apos;ll show up here.
                </p>
              ) : (
                conversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === activeConversationId}
                    onSelect={() => {
                      onSelect(conversation.id);
                      setOpen(false);
                    }}
                    onRename={(title) => onRename(conversation.id, title)}
                    onDelete={() => onDelete(conversation.id)}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
