-- Items 45 & 46 (RECOMMENDATIONS.md):
--
-- 45. Moderator post/comment deletion under `posts_delete_own_or_moderator` /
--     `comments_delete_own_or_moderator` is a hard delete. Once the row is
--     gone, `moderation_actions.target_id` points at nothing and the audit
--     trail records a decision with no recoverable evidence.
-- 46. The moderation queue shows target type, reporter and reason but never
--     the actual reported content, so moderators decide blind.
--
-- Both are solved by capturing a snapshot of the target's content at the
-- moment a report is filed. This is the smaller, more consistent change
-- versus soft-deleting posts/comments: soft-delete would require rewriting
-- the delete RLS policies into update policies and auditing every existing
-- read path (feed, Match Centre room, profile pages) to filter
-- `deleted_at is not null` — a much larger surface for a feature (moderator
-- deletion) that has no delete action wired up anywhere in the app yet.
--
-- `content_snapshot` is populated once, server-side, in reportContent()
-- (src/app/(app)/social/report-actions.ts) from the real target row at
-- report-creation time. It is intentionally nullable: if the target has
-- already vanished by the time the report is filed, no snapshot exists and
-- the moderation queue shows "content no longer available" rather than a
-- fabricated placeholder.
alter table reports
  add column content_snapshot jsonb;

comment on column reports.content_snapshot is
  'Immutable copy of the reported post/comment/profile content, captured at '
  'report-creation time. Survives hard-deletion of the target row so the '
  'audit trail keeps evidence and the moderation queue can render a preview '
  'even for already-deleted content. Populated once, in reportContent() '
  '(src/app/(app)/social/report-actions.ts); never overwritten afterwards.';

-- To reverse: alter table reports drop column content_snapshot — the
-- moderation queue reverts to showing no preview for deleted content.
