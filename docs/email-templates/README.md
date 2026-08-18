# KIVO — Supabase Auth email templates

Production-ready, KIVO-branded HTML for every email Supabase Auth sends, built
for the email-OTP-first flow (a six-digit code the user types, with a magic link
as the secondary path).

Six templates, each with a plain-text counterpart:

| File | Supabase template | Primary action |
| --- | --- | --- |
| `confirm-signup.html` / `.txt` | Confirm signup | **Code**, link secondary |
| `magic-link.html` / `.txt` | Magic Link | **Code**, link secondary |
| `reset-password.html` / `.txt` | Reset Password | **Link**, code secondary |
| `change-email.html` / `.txt` | Change Email Address | **Link**, code secondary |
| `invite.html` / `.txt` | Invite user | **Link** only |
| `reauthentication.html` / `.txt` | Reauthentication | **Code** only |

---

## 1. Where these go

### Hosted project (what KIVO uses)

Supabase Dashboard → your project → **Authentication → Emails → Templates**
(`/dashboard/project/<ref>/auth/templates`).

Pick the template in the left list, paste the **entire** contents of the matching
`.html` file into the message body, set the subject from the table below, save.
Repeat six times. There is no import; it is copy-paste per template.

Recommended subject lines — short, no emoji, no marketing, per Supabase's own
deliverability guidance:

| Template | Subject |
| --- | --- |
| Confirm signup | `{{ .Token }} is your KIVO confirmation code` |
| Magic Link | `{{ .Token }} is your KIVO sign-in code` |
| Reset Password | `Reset your KIVO password` |
| Change Email Address | `Confirm your new KIVO email address` |
| Invite user | `You've been invited to KIVO` |
| Reauthentication | `{{ .Token }} is your KIVO verification code` |

Putting the code in the subject is deliberate: iOS and Android surface it in the
notification and offer keyboard autofill, so most users never open the message.

### Local development / self-hosted

`supabase/config.toml` points at files on disk:

```toml
[auth.email.template.magic_link]
subject = "{{ .Token }} is your KIVO sign-in code"
content_path = "./docs/email-templates/magic-link.html"
```

Keys are `confirmation`, `magic_link`, `recovery`, `email_change`, `invite`,
`reauthentication`. `supabase stop && supabase start` to apply. Mail is captured
by Mailpit (`supabase status` prints the URL) — nothing leaves the machine.

Self-hosted Supabase does *not* read templates from a mounted volume; it fetches
each one over HTTP from a URL reachable by the `auth` container
(`GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=...`). If the fetch fails or the template is
invalid Go-template syntax, GoTrue silently falls back to its stock template.

### Management API (scriptable, useful for CI)

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg s "{{ .Token }} is your KIVO sign-in code" \
    --rawfile b docs/email-templates/magic-link.html \
    '{mailer_subjects_magic_link:$s, mailer_templates_magic_link_content:$b}')"
```

Field names follow `mailer_subjects_<key>` / `mailer_templates_<key>_content`.

---

## 2. Template variables

Supabase Auth renders these with [Go `text/template`](https://pkg.go.dev/text/template).
Verified against the Supabase docs (Email Templates + Customizing email templates):

| Variable | What it holds | Available in |
| --- | --- | --- |
| `{{ .Token }}` | The 6-digit one-time code | All auth templates |
| `{{ .ConfirmationURL }}` | Full verify URL incl. `token`, `type`, `redirect_to` | All auth templates |
| `{{ .TokenHash }}` | Hashed token, for hand-built links | All auth templates |
| `{{ .SiteURL }}` | Project Site URL (Auth → URL Configuration) | All |
| `{{ .RedirectTo }}` | The `redirectTo` passed to the client call | All |
| `{{ .Email }}` | User's current address. **Empty** when linking email to an anonymous user | All |
| `{{ .NewEmail }}` | The requested new address | **Change Email Address only** |
| `{{ .Data.<key> }}` | `auth.users.user_metadata` | All |

What these templates actually use: `.Token`, `.ConfirmationURL`, `.Email`, and
`.NewEmail` (change-email only). Nothing else, so there is no template that can
render a blank where a variable does not exist.

**Only Go template syntax works.** Liquid-style filters are a common and silent
failure: `{{ .Data.name | default: "there" }}` throws
`templatemailer_template_body_parse_error` and Supabase quietly serves its stock
template instead — your branding just vanishes with no error in the UI. If a
template stops applying, check **Logs → Auth Logs** first.

### The email-OTP gotcha worth knowing

`supabase.auth.signInWithOtp({ email })` does **not** always send the Magic Link
template. For an address that has never signed up (with `shouldCreateUser: true`)
Supabase sends **Confirm signup** instead. If `{{ .Token }}` is missing from the
Confirm signup template, brand-new users get a link-only email, the code entry
screen has nothing to accept, and signup appears broken while sign-in works.

That is why `confirm-signup.html` leads with the code, exactly like
`magic-link.html`. Do not "simplify" it back to a link-only template.

### Optional: PKCE / server-side link variant

These files ship with `{{ .ConfirmationURL }}`, which matches Supabase's defaults
and works without any route in the app.

If the auth code lands on the `@supabase/ssr` PKCE pattern with a
`/auth/confirm` route handler, swap the two `{{ .ConfirmationURL }}` occurrences
in a file (the `<a href>`/VML `href`, and the visible fallback URL) for:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next={{ .RedirectTo }}
```

`type` per template: `signup` (confirm signup), `magiclink`, `recovery`,
`email_change`, `invite`. **Only make this swap once that route exists** — there
is no fallback, the link 404s until it does. The OTP code path is unaffected
either way, which is the main reason the code is the hero.

---

## 3. SMTP: the built-in sender cannot ship to production

This is not an opinion, it is Supabase's own documented position, and it is the
single thing most likely to break a launch.

Until custom SMTP is configured, Supabase Auth **refuses to deliver to any
address that is not a member of the project's organization**. Everyone else gets
`Email address not authorized`. A real user signing up on the live site simply
never receives anything. Beyond that the built-in service is explicitly
best-effort with **no delivery or uptime SLA**, and is rate-limited to a value
Supabase can change without notice.

The docs render that hourly figure from live platform config
(`auth.rate_limits.email.inbuilt_smtp_per_hour`) rather than printing a fixed
number, so it is not quoted here — read the current value on **Authentication →
Rate Limits** in the dashboard. The numbers that *are* documented as fixed:

- Custom SMTP starts at **30 messages/hour**, raisable on the Rate Limits page.
- `/auth/v1/otp` defaults to **360 OTPs/hour**.
- A **60-second** cooldown between OTP/magic-link requests for the same user.
- `/auth/v1/verify`: 360 requests/hour per IP.

### What a real setup requires

Any SMTP provider works (Resend, AWS SES, Postmark, SendGrid, ZeptoMail, Brevo).
Set it at **Authentication → Emails → SMTP Settings**:

- Sender email (e.g. `no-reply@auth.<kivo-domain>`) and sender name (`KIVO`)
- SMTP host, port, username, password
- Then raise the 30/hour default on the Rate Limits page

Plus the parts that decide whether mail lands in the inbox at all:

1. **SPF, DKIM and DMARC** on the sending domain. Without these an OTP email
   from a brand-new domain goes to spam, and a spam-foldered OTP is a broken
   product.
2. **Separate auth from marketing.** Different subdomain and From address
   (`auth.` vs `marketing.`), so a marketing complaint spike can never take
   sign-in down.
3. **Turn OFF click/open tracking.** Tracking rewrites every link. It will
   rewrite `{{ .ConfirmationURL }}` and break magic links. Supabase calls this
   out explicitly.
4. **Set a Supabase custom domain**, so links point at a KIVO domain rather than
   `<ref>.supabase.co` — better deliverability and it doesn't look like a
   phishing attempt.
5. **Enable CAPTCHA** on signup/sign-in. Passwordless auth is a standing target
   for bots that burn sender reputation by mass-triggering OTP emails.

Also worth knowing about link prefetching: corporate scanners (Microsoft Defender
Safe Links and similar) fetch URLs in incoming mail. Supabase links are
single-use, so the scan consumes the token and the user then sees "Token has
expired or is invalid". **This is a second reason the six-digit code is the hero
of these templates** — a scanner cannot consume a code the user types.

---

## 4. Design and technical decisions

### Why there are no images

Every visual element is CSS and type. No logo file, no hero art, nothing remote.

KIVO's brand assets live in `public/brand/`, which is only reachable once
deployed, and their URLs would change with the domain. A brand asset that 404s
in a security email is worse than no asset — it reads as a spoof. On top of
that, most desktop clients block remote images by default, so a logo-image
header renders as a grey box on first open for a large share of recipients.

Instead: a gradient monogram tile (a table cell with `background-color` plus a
`linear-gradient` overlay) next to a letter-spaced `KIVO` wordmark, and the
brand hues carried by the 3px gradient rule across the top of the card. All of
it renders from HTML, so it cannot break, and it survives image blocking.

### Email HTML constraints these files respect

- Table-based layout only. No flexbox, no grid, no `position`.
- Every load-bearing style is inline. The `<style>` block holds only
  progressive enhancement (media queries, dark-mode overrides), because Gmail
  strips or rewrites it in clipped and forwarded views.
- No JavaScript, no external stylesheet, no web font. System font stacks with
  full fallbacks; an MSO conditional pins Outlook to Arial/Consolas since
  Word's renderer has no usable default mono face.
- CTAs are bulletproof buttons: a VML `<v:roundrect>` for Word-rendered Outlook,
  a padded anchor everywhere else.
- Every message with a CTA also prints the raw URL, quietly, for gateways that
  strip anchors.

Known, accepted degradations in Outlook (Word engine): `border-radius` is
ignored, so the card and panels render square; `letter-spacing` is ignored, so
the OTP digits sit tighter. Both are cosmetic — the code stays large, mono and
legible, which is the requirement.

### Dark mode without relying on `prefers-color-scheme`

The design is dark in every client by default. `prefers-color-scheme` is never
load-bearing; there is no separate light variant that has to be triggered.

Three specific defences:

1. `<meta name="color-scheme" content="dark">` and `supported-color-schemes`.
   Apple Mail, iOS Mail and Outlook for Mac honour these and render the design
   as authored instead of auto-inverting it.
2. `[data-ogsc]` / `[data-ogsb]` overrides. Outlook.com and Outlook mobile
   rewrite colours and stamp those attributes on what they touched; the rules
   restore the intended values.
3. **Paired colours on every cell.** Every element that sets a text colour also
   sets its own background on the same cell. The genuinely unreadable failure is
   *partial* inversion — background flipped, text not. Pairing them means a
   client that inverts one almost always inverts the other.

Point 3 is what makes the worst case survivable: a *fully* inverted dark design
is just a legible light design. That was checked, not assumed — see below.

Also deliberate: no `#000000` and no `#ffffff` in the palette (`#05060a` /
`#f8faff` instead). Gmail's inversion heuristics key hardest on pure black and
pure white.

### Palette

Traced from `src/app/globals.css`, with two documented deltas where email
rendering is harsher than the web app's (no antialiasing control, small type,
client colour filters):

| Role | Value | Source |
| --- | --- | --- |
| Page | `#05060a` | `--kivo-obsidian` |
| Card | `#0a0e1a` | between obsidian and `--kivo-navy-deep` |
| Panel / inset | `#0d1630` / `#080d1c` | `--kivo-navy` |
| Heading | `#f8faff` | `--kivo-white` |
| Body | `#a3b0c6` | **lifted** from `--kivo-slate-text` `#8592a8` |
| Caption in panel | `#8a97ad` | **lifted**; `#6d7a91` is under AA at 12px on `#0d1630` |
| Primary | `#2563ff` → `#00d9ff` | `--kivo-blue` → `--kivo-cyan` |
| Accent rule | + `#7c3fff`, `#d946ef` | `--kivo-violet`, `--kivo-magenta` |

Magenta appears once, in the top rule, and nowhere else — it stays the rare
accent the brand doc calls for.

### Copy

No taglines, no product pitch, no promotional links — Supabase's deliverability
guidance is explicit that marketing language in auth mail trips spam classifiers.
Every message states what happened, what to do, how long it lasts, and what to
do if it wasn't you.

---

## 5. Verified vs. still needs a real inbox

**This sandbox cannot send or receive email.** Nothing below was confirmed by an
actual delivered message.

Verified here:

- Every template variable name and its availability, against the Supabase docs
  (Email Templates, Customizing email templates, Custom SMTP, Production
  Checklist) via the Supabase docs MCP tool.
- The built-in SMTP restrictions (team-addresses-only, no SLA, rate limits) and
  the custom-SMTP field list — quoted from those docs, not from memory.
- Rendering. All six templates were rendered in headless Chromium at 390px and
  900px, screenshotted and reviewed, and iterated on: the card radius, the
  optical centring of the letter-spaced code, and the weight of the raw-URL
  block were all fixed as a result.
- Force-inversion behaviour, by rendering with a whole-page
  `invert(1) hue-rotate(180deg)` filter — the stand-in for a client that inverts
  everything. Result: a clean light email, hierarchy intact, code still the
  loudest element, brand hues preserved. One weak spot noted: the raw-URL
  fallback line gets faint under inversion. It is a secondary affordance behind
  both a code and a button, so it was left as is.
- Markup: balanced `<table>`/`<tr>`, no stray attributes, all six under 16 KB
  (well clear of Gmail's ~102 KB clipping threshold).

Not verified, and needing a real send before launch:

- **Actual client rendering.** Chromium is not Outlook. The VML button, the MSO
  font pinning and the squared-off corners in Word's engine are all written from
  the documented behaviour, not observed. Run these through Litmus or Email on
  Acid, or send to real Outlook 2016+/365, Gmail Android, Gmail iOS, Apple Mail
  and Outlook.com accounts.
- **Real dark-mode behaviour** in Gmail Android and Outlook.com. The defences are
  the right ones; whether each client leaves the design alone can only be seen in
  the client.
- **iOS/Android OTP autofill** actually triggering from the subject and body.
- **Deliverability.** Inbox vs. spam depends entirely on SPF/DKIM/DMARC and
  domain reputation, none of which exist yet.
- **Expiry copy.** The templates say "expires in 1 hour", which matches
  Supabase's recommended OTP expiry (≤ 3600s). If the project's OTP expiry is set
  to something else on **Authentication → Providers**, update the copy in the
  HTML *and* the `.txt` files to match — stating a wrong expiry is worse than
  stating none.

## 6. Editing

The six templates share one chrome deliberately. If you change the header,
footer, button or code panel, change it in all six or they stop reading as one
family. The `.txt` counterpart of any file you edit needs the same edit.

Two things to preserve in any edit:

- Keep `{{ .Token }}` in Confirm signup (see §2).
- Keep an explicit `bgcolor`/`background-color` on every cell that sets a text
  colour (see §4).

The plain-text files are reference copy. The Supabase dashboard exposes a single
HTML body per template and no separate text part, so they are not installable as
-is; they apply if KIVO later moves to the **Send Email Hook**, which takes over
sending entirely and lets you build a proper `multipart/alternative` message.
