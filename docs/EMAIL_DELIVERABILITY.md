# Email deliverability — the launch blocker

`KIVO_NEXT_GEN.md` KN-117. Written for the founder, because every remaining step is a dashboard or DNS action that cannot be taken from a code session.

## Why this is a blocker and not a nice-to-have

> **Rewritten 2026-08-19.** This document used to open with "KIVO has exactly one way in: a six-digit code emailed to one address. No password, no social login, no recovery factor." That is no longer true — KIVO has passwords (`DECISIONS.md`, "KIVO has passwords again"). The conclusion did not change, but the reasoning behind it did, and a runbook arguing from a fact that stopped being true is worse than no runbook.

KIVO now has two ways in — an email and password, and a six-digit code as the secondary option — plus a password reset. **Email is still on the critical path for every one of them**, and for two of the three it is the *only* path:

| What the user is doing | Needs an email to arrive? |
| --- | --- |
| Creating an account | **Yes, always.** Supabase's confirmation code is the only way to finish a sign-up. |
| Signing in with a password they know | No. This is what passwords bought. |
| Signing in with a code | **Yes.** |
| Resetting a forgotten password | **Yes.** |
| Setting a first password on a pre-password account | **Yes** — either route (a sign-in code, or Forgot password) goes through the inbox. |

So what changed is the *shape* of the risk, not its size. Before, a mail failure locked out everybody on every visit. Now it locks out **everybody who is new, and everybody who has forgotten their password** — which on a launch-day cohort is most of the traffic, and which is precisely the moment a first impression is formed. A person who cannot sign in has no way to tell the difference between "my mail is broken" and "this app is broken."

There is now one genuine improvement worth naming, because it changes what "degraded" means: a returning user with a password is unaffected by a mail outage entirely. That is why passwords were worth the threat model they brought with them. It is not a reason to leave SMTP unconfigured.

That asymmetry is why this document exists and why the work below should happen before the first real cohort, not after the first complaint.

## What is true right now

**Verified, not assumed** — checked against the live project on 2026-08-18:

- **Supabase's built-in sender does deliver.** There is a real account on the project, created today, on a real `@gmail.com` address, with a `profiles` row provisioned by `getOrCreateProfile()`. So the OTP path works end to end at least once, to at least one large consumer mailbox. That is worth knowing, because it rules out "the flow is broken" as an explanation for any delivery problem you hit next.
- **It will not scale, and Supabase says so.** The built-in sender is documented as being for development, and is throttled to a handful of messages per hour **per project**, shared across every auth email type. A launch day where thirty people sign up in an hour does not partly work — it stops, and the people it stops are indistinguishable to themselves from people whose mail bounced. `describeAuthError` in `src/lib/auth-actions.ts` already handles `over_email_send_rate_limit` honestly, but "we are throttled" is a bad first impression to have built a good error message for.
- **No custom SMTP is configured**, and nothing in this repository can verify that it is — SMTP settings live in the Supabase dashboard, not in any file or env var here. Treat any claim in any document that says otherwise as unverified.
- **The templates are ready.** `docs/email-templates/` carries twelve files (HTML and text) and its `README.md` has the install steps. Read that README before touching the dashboard: which template Supabase sends depends on whether the address has signed up before, and **three** templates must contain `{{ .Token }}` — Confirm signup (sign-up), Magic Link (the code sign-in), and Reset Password (the forgotten-password code). A template missing it produces a link and no code, and a user staring at a code screen for a code that was never sent.
- **Three auth emails now exist, not two.** Password reset (`resetPasswordForEmail`) sends the Reset Password template and is subject to exactly the same project-wide throttle as the other two. Budget for it: a launch cohort generates reset traffic almost immediately.
- **Nothing has been tested against a real delivered email from this session.** The sandbox this was written in blocks `*.supabase.co` outright. Everything above about delivery comes from database state, not from an inbox.

## What to do, in order

### 1. Pick a sending domain and a provider

`ENVIRONMENT.md` reserves `RESEND_API_KEY` / `RESEND_FROM_EMAIL`. Resend is a reasonable default, and any SMTP provider works — Supabase sends the mail either way and **no application code changes** when you switch.

Use a real KIVO domain, not a personal one and not a subdomain of a free host. Deliverability is largely a reputation question and reputation attaches to the domain.

A useful convention worth adopting now, while there is nothing to migrate: send auth mail from a **subdomain** (`mail.<yourdomain>` or `auth.<yourdomain>`). If transactional reputation is ever damaged, the damage is contained to the subdomain and your primary domain's ability to send ordinary mail survives.

### 2. Authenticate the domain — all three records

This is the part that decides whether mail lands in the inbox or the spam folder, and all three matter. Your provider generates the exact values; what each one is *for*:

- **SPF** — a DNS TXT record listing who is allowed to send as your domain. Without it, a receiving server has no way to distinguish your mail from anyone forging your domain, and Gmail and Outlook both weight that heavily.
- **DKIM** — a cryptographic signature on each message, with the public key published in DNS. Proves the message was not altered in transit and really came from you.
- **DMARC** — a TXT record at `_dmarc.<domain>` telling receivers what to do when SPF and DKIM fail, and where to send reports. Start at `p=none` with a reporting address so you can *see* what is happening before you enforce anything; move to `p=quarantine` and then `p=reject` once the reports are clean. Going straight to `p=reject` before the other two records are verified is a reliable way to make your own mail disappear.

Since 2024 both Google and Yahoo require SPF, DKIM **and** DMARC for bulk senders. Treat all three as mandatory rather than as a maturity ladder.

### 3. Wire it into Supabase

Dashboard → Project Settings → Authentication → SMTP Settings. Fill in the provider's host, port, username and password, and set the sender name and address to the domain you just authenticated. The sender address must be on the authenticated domain — that is the whole point of step 2.

Then raise the rate limits: Dashboard → Authentication → Rate Limits. The built-in per-hour email cap stays in force until you change it, custom SMTP or not, and leaving it at the development default is the single most likely way to ship all of this and still be throttled on launch day.

### 4. Send a real test to real mailboxes

Not one address. At minimum Gmail, Outlook/Hotmail, and one corporate address on a domain running its own filtering — corporate filters are the strictest and are the case `/support` exists for. Check the spam folder in each, not just the inbox, and check that the six-digit code is actually present in the message body rather than only a link (see the templates README).

### 5. The bounce and complaint path

This is the part most easily skipped and the one that quietly degrades everything else.

- **Turn on the provider's bounce and complaint webhooks or reports**, and decide who reads them. A hard bounce means that address will never receive KIVO mail again; continuing to send to it damages the domain's reputation for everyone else.
- **A spam complaint is a hard stop for that address.** Providers will suppress it automatically; the thing to avoid is treating repeated suppressed sends as a mystery.
- **Wire the human side to the queue that already exists.** `/support` and `/admin/support` (migration `0055`) are where a user whose mail never arrived can reach a person, and `docs/ACCOUNT_RECOVERY.md` is the procedure. Deliverability work reduces the volume in that queue; it does not replace it, because some fraction of mail is undeliverable for reasons no configuration fixes.

## What KIVO does not have, stated plainly

- **No transactional email of its own.** `RESEND_API_KEY` is reserved and unread by any code in this repository. `/support`'s confirmation screen says a person will reply from a real mailbox, because that is literally the mechanism — there is no automated reply to send.
- **No bounce handling inside the product.** Bounces are visible in the provider's dashboard and nowhere in KIVO. Nothing marks a `profiles` row as unreachable, so a user with a dead address looks identical to one who has not signed in lately.
- **No second sign-in factor.** This is the real structural fix and it is not built: a passkey, or a recovery code issued at sign-up, turns "email unreachable" from a permanent lockout into self-service recovery. Recorded here so the trade-off being made in the meantime is a visible one. See `docs/ACCOUNT_RECOVERY.md` §5.
