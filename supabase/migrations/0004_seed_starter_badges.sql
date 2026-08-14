-- Starter badge catalog — reference data, not user achievement data (no
-- user_badges rows are seeded here; those are only ever awarded by trusted
-- server-side logic at the moment a user actually earns them).
insert into badges (code, name, description, icon_url) values
  ('welcome', 'Welcome to KIVO', 'Completed onboarding and picked a KIVO handle.', '/assets/icons/fantasy-rewards/achievements.webp'),
  ('first_post', 'First Word', 'Posted for the first time in the KIVO community.', '/assets/icons/social/chat-social.webp')
on conflict (code) do nothing;
