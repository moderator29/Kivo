-- RECOMMENDATIONS.md item 308: "versioned/config-driven scoring (not
-- hardcoded)" — fantasy-scoring.ts's point values were never stamped with a
-- version the way rating-engine.ts's RATING_MODEL_VERSION already is, so a
-- future tuning of GOAL_POINTS_BY_POSITION/APPEARANCE_POINTS/etc. would make
-- every previously-scored gameweek ambiguous about which ruleset produced
-- it. Nullable, no default: existing rows genuinely predate versioning and
-- backfilling them with today's version would be a fabricated claim about
-- what actually scored them — they stay honestly null. Every row scoreFantasyGameweek
-- writes from this point forward carries the real SCORING_MODEL_VERSION
-- constant from src/lib/fantasy-scoring.ts at the moment it was computed.
alter table fantasy_points
  add column scoring_model_version text;

comment on column fantasy_points.scoring_model_version is
  'The SCORING_MODEL_VERSION (src/lib/fantasy-scoring.ts) in effect when this row was computed by scoreFantasyGameweek. Null on rows written before this column existed — not backfilled, since the actual ruleset that produced them was never recorded.';

-- To reverse: alter table fantasy_points drop column scoring_model_version;
