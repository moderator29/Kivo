-- Expanded badge catalog — reference data only (no user_badges rows are
-- seeded here; those are only ever awarded by trusted server-side logic at
-- the moment a user actually earns them, same rule as 0004). Every badge
-- below is tied to a condition the schema genuinely tracks and that the
-- awarding code (see src/lib/rewards.ts call sites) verifies really
-- happened before calling awardBadge — no speculative or guessed milestones,
-- and no streak badge since there is no consecutive-day/consecutive-correct
-- tracking column anywhere in this schema to back one honestly.
insert into badges (code, name, description, icon_url) values
  ('first_prediction_correct', 'Called It', 'Got your first match prediction right.', '/assets/icons/navigation/predictions.webp'),
  ('five_predictions_correct', 'Prediction Pro', 'Got 5 match predictions right.', '/assets/icons/navigation/predictions-alt-1.webp'),
  ('fantasy_gameweek_scored', 'On the Board', 'Scored your first points in a fantasy gameweek.', '/assets/icons/fantasy-rewards/fantasy.webp'),
  ('fantasy_league_joined', 'Squad Assembled', 'Joined a fantasy league.', '/assets/icons/fantasy-rewards/my-team.webp'),
  ('first_follow', 'Fan Club', 'Followed your first team, player or competition.', '/assets/icons/social/fan-clubs.webp'),
  ('five_follows', 'Superfan', 'Followed 5 teams, players or competitions.', '/assets/icons/social/friends.webp'),
  ('first_comment', 'Joined the Conversation', 'Left your first comment in the community.', '/assets/icons/social/messages.webp'),
  ('ten_posts', 'Regular', 'Posted 10 times in the KIVO community.', '/assets/icons/social/communities.webp')
on conflict (code) do nothing;
