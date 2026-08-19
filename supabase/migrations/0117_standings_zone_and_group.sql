-- =============================================================================
-- The qualification zone, the group, and the form string — all already paid for
-- =============================================================================
-- A league table without its zones is a list of numbers. What makes it football
-- is knowing that the line under 4th is the Champions League and the line above
-- 18th is relegation.
--
-- KIVO could not draw those lines, and the Competitions agent was right to
-- refuse the obvious workaround: hardcoding "Premier League top 4 = Champions
-- League" into the product. That is an unverifiable football claim with an
-- expiry date — UEFA changes coefficients, leagues restructure, a country gains
-- or loses a place — and a wrong line drawn confidently is worse than no line.
--
-- It turns out KIVO does not have to claim anything, because THE PROVIDER
-- ALREADY STATES IT. API-Football's `/standings` sends a per-row `description`
-- ("Promotion - Champions League (Group Stage)", "Relegation - Championship"),
-- a `group` ("Group A"), and a `form` string ("WWDLW"). The adapter's response
-- interface declared none of the three, so `getStandings` never saw them and
-- every one was silently discarded.
--
-- This is the fourth instance tonight of the same bug shape: a field arriving
-- on a payload KIVO already pays for, undeclared in the response type, dropped
-- on the floor, and then experienced by the founder as a missing feature.
-- Referee, round label and venue city were the other three. Worth naming as a
-- class rather than fixing four times in isolation: **an adapter's response
-- interface is not documentation, it is a filter.** Anything it omits, the
-- product cannot have.
--
-- -----------------------------------------------------------------------------
-- Why these are stored as the provider's own strings
-- -----------------------------------------------------------------------------
-- `zone_description` is text, verbatim, not an enum. Two reasons, and the
-- second is the important one:
--
--   1. The vocabulary is not fixed. Every competition phrases it differently,
--      and a new phrasing must not fail an insert.
--   2. An enum would require KIVO to decide which bucket a phrase belongs in AT
--      WRITE TIME, permanently, discarding the original. Keeping the provider's
--      sentence means a reader can always be shown exactly what the provider
--      said, and any classification the UI does (colour this green, that red)
--      is a presentation choice made over data that is still intact — reversible,
--      and never mistaken for a fact KIVO asserted.
--
-- So the rule for the table above it: colour what you can classify, and for
-- anything you cannot, still SHOW the description. An unclassified zone is not
-- noise to be dropped; the text is true either way.
--
-- `group_label` exists because a Champions League group stage is eight tables,
-- not one 32-row ladder, and `standings.position` is per-group. Without it the
-- UI cannot tell those apart and renders a nonsense ordering.
--
-- `form` is the provider's own last-five string. KIVO computes its own form
-- elsewhere (form-engine.ts) from finished fixtures it holds, and the two are
-- deliberately kept separate: one is the provider's statement, the other is
-- KIVO's derivation over its own data, and collapsing them would make it
-- impossible to tell which was on screen.

alter table standings add column if not exists zone_description text;
alter table standings add column if not exists group_label text;
alter table standings add column if not exists form text;

comment on column standings.zone_description is
  'The provider''s own qualification/relegation phrase for this row, verbatim ("Promotion - Champions League (Group Stage)"). Never KIVO''s classification. Null means the provider said nothing, which is not the same as "no zone" — the UI must render nothing rather than implying mid-table safety.';

comment on column standings.group_label is
  'The provider''s group name for competitions played in groups ("Group A"). Null for a single-table league. `position` is per-group, so a UI that ignores this renders eight tables as one nonsensical ladder.';

comment on column standings.form is
  'The provider''s own recent-form string ("WWDLW"). Deliberately distinct from KIVO''s form-engine.ts derivation over fixtures it holds — one is a provider statement, the other is KIVO''s own, and they must stay tellable apart.';

-- To reverse:
--   alter table standings drop column if exists form;
--   alter table standings drop column if exists group_label;
--   alter table standings drop column if exists zone_description;
