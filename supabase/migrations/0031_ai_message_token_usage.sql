-- RECOMMENDATIONS.md item 190: "Cap cost per user."
--
-- No token accounting existed anywhere for the AI Copilot. Persist the
-- Anthropic usage figures the API already returns on every call
-- (response.usage.input_tokens / output_tokens, or the streaming
-- equivalent's finalMessage().usage — see src/app/api/ai/chat/route.ts) onto
-- the assistant's ai_messages row, so spend is visible per conversation and
-- per user without a separate ledger table. Nullable because user-role rows
-- never carry usage — only the assistant reply that consumed those tokens
-- does.
--
-- The actual daily-ceiling *enforcement* in this pass reuses the existing
-- checkRateLimit()/rate_limit_events sliding-window pattern (a message-count
-- cap, same shape as the per-minute "ai_chat" limit already in
-- src/app/api/ai/chat/route.ts) rather than summing these columns on every
-- request — see that file's AI_CHAT_DAILY_MAX_REQUESTS comment. These
-- columns exist so real per-user/per-conversation cost is queryable later
-- (e.g. an admin report) without a schema change at that point.

alter table ai_messages
  add column input_tokens  integer,
  add column output_tokens integer;

alter table ai_messages add constraint ai_messages_input_tokens_non_negative
  check (input_tokens is null or input_tokens >= 0);

alter table ai_messages add constraint ai_messages_output_tokens_non_negative
  check (output_tokens is null or output_tokens >= 0);

comment on column ai_messages.input_tokens is
  'response.usage.input_tokens from the Anthropic API call that produced this row (the whole request: system + history + this turn). Null for role=user rows and for any assistant row inserted before this column existed.';
comment on column ai_messages.output_tokens is
  'response.usage.output_tokens from the Anthropic API call that produced this row. Null for role=user rows and for any assistant row inserted before this column existed.';

-- To reverse: alter table ai_messages drop column input_tokens, drop column output_tokens
-- (also drops the two check constraints along with their columns).
