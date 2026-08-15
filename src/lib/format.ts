/** Compact relative-time label ("just now", "5m", "3h", "2d") for a
 * timestamp already close to now — used on social posts and notifications.
 * Was defined identically in both places before this was consolidated.
 * Beyond 30 days this switches to a real date (e.g. "14 Aug" / "14 Aug 2025"
 * across a year boundary) rather than an ever-growing day count. */
export function timeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}
