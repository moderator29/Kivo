import { createServerSupabaseClient } from "@/lib/supabase/server";
import { matchRoomWindow } from "@/lib/match-room-window";
import { logError } from "@/lib/log";

/**
 * The server-side half of the Match Room's posting window.
 *
 * The UI already hides the composer once a room has closed, and that is worth
 * exactly nothing as a rule: `posts` is writable through PostgREST with the
 * same publishable key the browser holds, so anything enforced only in a React
 * component is enforced only against people who use the React component. The
 * actual boundary is the RESTRICTIVE policy in migration 0110. This function
 * sits between the two, and its job is not security — it is the error message.
 * Without it a late post fails as a raw RLS violation, which reaches the fan as
 * "Couldn't publish your post. Try again." and invites them to try again
 * forever.
 *
 * WHAT IT DOES ON A FAILED READ, AND WHY
 * ---------------------------------------------------------------------------
 * It allows the post. A fixture row that cannot be read here is KIVO's
 * problem, and the failure mode of guessing "closed" is silencing a real
 * conversation about a real match — while the failure mode of guessing "open"
 * is one post that the database will refuse anyway, because the policy makes
 * the same decision from inside the transaction with no read to fail. Every
 * unhappy path here degrades to the policy's answer rather than to a lockout,
 * which is the whole reason the policy exists.
 */
export async function matchRoomAcceptsPosts(
  fixtureId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fixtures")
    .select("kickoff_at, status")
    .eq("id", fixtureId)
    .maybeSingle();

  if (error) {
    logError("matchRoom.windowLookup", error);
    return { ok: true };
  }
  // No such fixture. Not this function's call to make: the foreign key on
  // posts.fixture_id already refuses it, with a clearer cause than a made-up
  // "this room is closed".
  if (!data) return { ok: true };

  const window = matchRoomWindow(data.kickoff_at, data.status);
  if (window.open) return { ok: true };

  // No timestamp in the message. A server action returns a plain string, so
  // there is nowhere to resolve the reader's time zone, and a close time
  // rendered in UTC is wrong by up to half a day for exactly the audience KIVO
  // launches into. The Room itself shows the moment it closed, through
  // <LocalDateTime>, in the reader's own zone.
  return {
    ok: false,
    error: "This match room closed a day after full time. You can still read it.",
  };
}
