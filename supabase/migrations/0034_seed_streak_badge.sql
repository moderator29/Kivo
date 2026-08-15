-- RECOMMENDATIONS.md item 169: "directly reusable as badge criteria" — this
-- is the badge 0016's comment said couldn't honestly exist yet ("no streak
-- badge since there is no consecutive-day/consecutive-correct tracking
-- column anywhere in this schema to back one honestly"). It's backed now:
-- scorePredictions (predictions-actions.ts) computes a real current streak
-- from predictions.points_awarded ordered by fixture kickoff_at (see
-- computeStreaks() in lib/predictions.ts) and awards this the moment that
-- streak genuinely reaches 3, the same way five_predictions_correct is
-- awarded off a real count.
insert into badges (code, name, description, icon_url) values
  ('three_prediction_streak', 'Hot Streak', 'Got 3 match predictions right in a row.', '/assets/icons/navigation/prediction-ai.webp')
on conflict (code) do nothing;

-- To reverse: delete from badges where code = 'three_prediction_streak' —
-- safe only if no user_badges rows reference it yet (check first).
