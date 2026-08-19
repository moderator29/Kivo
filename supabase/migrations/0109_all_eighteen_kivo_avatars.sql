-- All 18 KIVO avatars become selectable.
--
-- 0043 restricted `profiles.avatar_kivo_id` to the 5 designs
-- (06/08/11/12/17) whose baked-in corner watermark could be trimmed away
-- without cutting into the character — RECOMMENDATIONS.md item 231. That
-- constraint is doing exactly what it was written to do; what changed is the
-- decision behind it. The founder's instruction is that every one of the 18
-- commissioned designs ships, shown whole rather than trimmed or cropped, so
-- the watermark question no longer gates the set. The app-side list
-- (KIVO_AVATAR_IDS in src/lib/kivo-assets.ts) and the exported files in
-- public/assets/kivo/avatars/ now carry all 18, and this brings the database's
-- defence-in-depth copy of that list back in sync with them.
--
-- Widening a CHECK is additive: every value the old constraint permitted the
-- new one still permits, so no existing profile row can be invalidated by it
-- and no backfill is needed. Postgres has no ALTER ... CHECK, so the
-- constraint is dropped and recreated under the same name in one transaction.
--
-- Backgrounds are deliberately untouched. Item 232's two excluded covers
-- (kivo-bg-03, kivo-bg-06) have "KIVO" rendered as content *inside* the scene
-- — pitch markings and building signage — which is a different problem from a
-- corner overlay and is not settled by this decision.
--
-- To reverse:
--   alter table profiles drop constraint profiles_avatar_kivo_id_confirmed_clean;
--   update profiles set avatar_kivo_id = 'kivo-avatar-08'
--     where avatar_kivo_id is not null and avatar_kivo_id not in (
--       'kivo-avatar-06','kivo-avatar-08','kivo-avatar-11','kivo-avatar-12','kivo-avatar-17');
--   alter table profiles add constraint profiles_avatar_kivo_id_confirmed_clean check (
--     avatar_kivo_id is null or avatar_kivo_id in (
--       'kivo-avatar-06','kivo-avatar-08','kivo-avatar-11','kivo-avatar-12','kivo-avatar-17'));
-- Note the middle step: reversing is NOT a pure schema change, because by then
-- real people may have chosen one of the 13 newly-allowed avatars and their
-- rows would fail the narrower constraint. Reassigning them silently is the
-- honest cost of the rollback, and is why it is written down here rather than
-- left to be discovered.

alter table profiles
  drop constraint profiles_avatar_kivo_id_confirmed_clean;

alter table profiles
  add constraint profiles_avatar_kivo_id_confirmed_clean check (
    avatar_kivo_id is null or avatar_kivo_id in (
      'kivo-avatar-01', 'kivo-avatar-02', 'kivo-avatar-03', 'kivo-avatar-04',
      'kivo-avatar-05', 'kivo-avatar-06', 'kivo-avatar-07', 'kivo-avatar-08',
      'kivo-avatar-09', 'kivo-avatar-10', 'kivo-avatar-11', 'kivo-avatar-12',
      'kivo-avatar-13', 'kivo-avatar-14', 'kivo-avatar-15', 'kivo-avatar-16',
      'kivo-avatar-17', 'kivo-avatar-18'
    )
  );
