/**
 * The `support_request_topic` enum (migration 0055) with the words a person
 * actually reads. Shared by the public form and the admin queue so the two can
 * never drift apart, and kept out of the `"use server"` action file because a
 * server-action module may only export async functions.
 */
export const SUPPORT_TOPICS = [
  {
    value: "sign_in",
    label: "I can't sign in",
    hint: "No code arrived, the code doesn't work, or you're not sure which email you used.",
  },
  { value: "account", label: "My account", hint: "Username, your data, or deleting your account." },
  { value: "bug", label: "Something's broken", hint: "A page, a button or a screen that isn't behaving." },
  {
    value: "data_correction",
    label: "Football data looks wrong",
    hint: "A score, lineup, or stat that doesn't match what happened.",
  },
  { value: "other", label: "Something else", hint: "Anything the options above don't cover." },
] as const;

export type SupportTopic = (typeof SUPPORT_TOPICS)[number]["value"];

export const SUPPORT_TOPIC_LABELS: Record<SupportTopic, string> = Object.fromEntries(
  SUPPORT_TOPICS.map((topic) => [topic.value, topic.label]),
) as Record<SupportTopic, string>;
