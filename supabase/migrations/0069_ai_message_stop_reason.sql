-- =============================================================================
-- 0069 — Record why an AI reply stopped
-- =============================================================================
-- KIVO_NEXT_GEN.md KN-24.
--
-- `/api/ai/chat` sets `max_tokens: 1024` and never looked at
-- `finalMessage.stop_reason`. When the model hits that ceiling the reply stops
-- mid-sentence, and everything downstream treats it as a finished answer: it is
-- written to `ai_messages` indistinguishably from a complete one, rendered
-- without comment, and offered for "regenerate" with no explanation of why it
-- reads oddly.
--
-- That is the same failure the platform already refuses everywhere else. KIVO's
-- rule is that it never presents something as more certain or more complete
-- than it is — items 188/189 applied that to provenance (fact vs. calculated
-- insight vs. uncertainty); this applies it to completeness. An answer that was
-- cut off mid-thought is not a wrong answer, but presenting it as a whole one
-- is a wrong claim about it.
--
-- WHY A COLUMN AND NOT JUST A STREAM FRAME
-- ----------------------------------------
-- A stream frame alone would tell the user who was watching it happen, and
-- nobody else: reopening the conversation from the history panel re-reads
-- `ai_messages`, where the signal would not exist. The truncation has to be
-- durable or it is only half-told.
--
-- Stored as the API's own `stop_reason` string rather than a boolean, because
-- "why did this stop" is genuinely more than one thing (`max_tokens`,
-- `end_turn`, `stop_sequence`, `refusal`, `pause_turn`, tool use) and a boolean
-- would have to be re-derived and re-migrated the first time another value
-- mattered. Null for every row written before this migration and for any row
-- where the API did not report one — deliberately NOT backfilled to 'end_turn',
-- which would be inventing a fact about replies nobody recorded one for.
-- =============================================================================

alter table ai_messages add column if not exists stop_reason text;

comment on column ai_messages.stop_reason is
  'Why the model stopped generating this reply, verbatim from the Anthropic API (max_tokens, end_turn, stop_sequence, refusal, ...). Null for a user message, for rows written before migration 0069, and whenever the API reported none - never backfilled with a guess. ''max_tokens'' is what the UI renders a "cut short" affordance for (KN-24).';

-- Deliberately not an enum: the set of stop reasons is the API vendor's, not
-- KIVO's, and a new value appearing upstream must not start failing writes on a
-- reply that was otherwise fine. The length cap is the only guard that belongs
-- here.
alter table ai_messages
  add constraint ai_messages_stop_reason_length
  check (stop_reason is null or char_length(stop_reason) between 1 and 64);

-- =============================================================================
-- To reverse
-- =============================================================================
-- alter table ai_messages drop constraint if exists ai_messages_stop_reason_length;
-- alter table ai_messages drop column if exists stop_reason;
