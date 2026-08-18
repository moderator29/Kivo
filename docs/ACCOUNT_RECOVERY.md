# Account recovery — the manual procedure

**Who this is for**: whoever is on support duty for KIVO. It is the operator half of `/support` and `/admin/support`, built for `KIVO_NEXT_GEN.md` KN-118.

**Why it has to exist at all.** KIVO has exactly one sign-in factor: a six-digit code emailed to one address (migration `0053`). No password, no social login, no second factor, no recovery codes. That is a deliberate, defensible choice — but it means the failure mode is total. If the email does not arrive, the user is not inconvenienced, they are locked out permanently, and no amount of retrying will change that. There is no self-service path back. A person has to do it.

Everything below is procedure a human follows. None of it is automated, and nothing in the codebase pretends otherwise.

---

## 1. Where requests arrive

`/support` (public, deliberately outside the authenticated app group) writes to the `support_requests` table. `/admin/support` reads it. Visible to `support_admin`, `admin` and `super_admin` only — the rows carry email addresses, so the role set is narrower than moderation's.

There is no email notification when a request lands. **Somebody has to open `/admin/support`.** Until KIVO has transactional email of its own (see `ENVIRONMENT.md`, `RESEND_API_KEY`), checking that page daily *is* the on-call rota. Say that out loud in whatever runbook the team keeps; a queue nobody opens is worse than no queue, because the form promises a person.

## 2. Triage: what is actually wrong

Most `sign_in` requests are one of four things, in rough order of frequency:

1. **The email went to spam.** Ask them to search for the phrase `sign in to KIVO` including spam/junk/promotions. Every KIVO auth email also carries a tap-to-sign-in link (`/auth/callback`), so even a mail whose six-digit code was mangled will still work if they tap it.
2. **They never had an account.** `/sign-in` deliberately no longer tells anybody whether an address is registered (KN-124), so the user genuinely cannot tell these apart from the outside — you can. Check `auth.users` for the address; if it is absent, tell them to use `/sign-up`.
3. **They typed the address wrong at sign-up.** Their real account is under an address they cannot receive at. This is the only case that needs section 3.
4. **Supabase's built-in SMTP is throttled.** Until custom SMTP is configured (`ENVIRONMENT.md`, and KN-117) the project's built-in sender allows only a handful of messages per hour *for the whole project*. If several people report this at once on the same day, suspect this before suspecting their mailbox — and check the Supabase dashboard's auth logs.

## 3. Recovering an account whose email address is unreachable

**This is an identity decision, not a technical one.** Changing which email owns an account hands somebody else's data to whoever asked. Do not do it on the strength of a plausible-sounding message.

**Before touching anything, establish that the requester is the account holder.** With no password there is no secret to check, so identity has to come from facts only the owner would know. Ask for several, and require them to agree:

- the exact display name and username on the account,
- roughly when they signed up,
- which clubs/competitions they follow,
- a recent action only they would know about (a prediction they made, a fantasy squad's captain, a post they wrote),
- the mistyped address they think they used.

Cross-check the answers against `profiles`, `follows`, `predictions`, `fantasy_*` and `posts` for that account. A requester who gets these wrong, or who answers vaguely, is not verified — and "they seemed genuine" is not verification.

**If you are not satisfied, do not proceed.** The honest answer is: *"We can't safely move an account to a different email without being sure it's yours. You can create a new account on an address you control — you'll start fresh."* A lost fantasy squad is recoverable. A handed-over account is not.

**If you are satisfied**, the change is made in the Supabase dashboard (Authentication → Users → the user → change email), not from application code. There is deliberately no admin UI for this in KIVO: an account-takeover primitive should not be one mis-click away inside the product, and it should leave a trail in Supabase's own audit rather than only in KIVO's.

Afterwards:

- record what you verified in the request's internal note, in enough detail that a second person could review the decision later,
- set the request to `closed`,
- tell the user, from your own mailbox, that it is done.

## 4. What we cannot do, and must not imply we can

- **We cannot recover an account we cannot verify.** See above.
- **We cannot email anyone from KIVO.** Every reply comes from a person's own mail client. `/support`'s confirmation screen says exactly that; do not let the copy drift into promising a ticket number, an SLA, or an automated update, because nothing behind it can honour one.
- **We cannot see the user's inbox.** If Supabase's logs say the message was accepted for delivery and the user says it never arrived, the honest answer is that it was sent and something between us and them dropped it — usually a filter. Suggest a different address.
- **We cannot tell whether an address has an account, from the outside.** That is intentional (KN-124). Only an operator with dashboard access can check, and that is the whole point.

## 5. When this document stops being necessary

Two changes retire most of it, and both are already named in the backlog:

- **Custom SMTP with SPF/DKIM/DMARC on a real sending domain** (KN-117). Deliverability is the root cause of nearly every request in section 2, and the built-in sender is explicitly not a production sender.
- **A second sign-in factor** — a passkey, or a recovery code issued at sign-up. Either one turns "email unreachable" from a permanent lockout into a self-service recovery, which is the only real fix. Not built, not scheduled; recorded here so the trade-off being made in the meantime is visible rather than assumed.
