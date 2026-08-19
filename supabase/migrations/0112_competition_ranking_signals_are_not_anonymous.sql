-- =============================================================================
-- 0112 — corrects 0111: the ranking signals are not for anonymous callers
-- =============================================================================
-- 0111 granted execute on `get_competition_provider_ids` and
-- `get_competition_follower_counts` to `anon` as well as `authenticated`, on the
-- reasoning that /matches should order its groups the same way for a signed-out
-- visitor as for a member.
--
-- There is no signed-out visitor. Migration 0059 ("close the anon surface")
-- removed `anon` from the select policy on every football reference table —
-- competitions, fixtures, teams and the rest — because `src/app/(app)/layout.tsx`
-- redirects a signed-out request to /sign-in before any page in the group
-- renders (see src/lib/guest-preview.ts, GUEST_PREVIEW_ENABLED = false). An
-- anonymous caller cannot read the fixtures these functions rank, so the grant
-- bought nothing and quietly widened a surface that migration deliberately
-- narrowed. 0059's own reversal note is explicit that re-granting things to
-- anon is part of the *public preview* decision, not something to do piecemeal.
--
-- 0111 is left exactly as it ran, per this project's rule that an applied
-- migration is corrected by a later one rather than edited. If the KN-119
-- public-preview decision is ever made, these two functions belong in the same
-- batch as the football reference tables, not ahead of them.
-- =============================================================================

revoke execute on function public.get_competition_provider_ids(text, uuid[]) from anon;
revoke execute on function public.get_competition_follower_counts(uuid[]) from anon;

-- To reverse (only alongside re-opening the football reference tables to anon):
--   grant execute on function public.get_competition_provider_ids(text, uuid[]) to anon;
--   grant execute on function public.get_competition_follower_counts(uuid[]) to anon;
