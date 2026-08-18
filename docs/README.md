# KIVO documentation index

KN-97. There are fifteen architecture documents in this folder and, until this
file, the only way to know one existed was to already know it existed. Each one
below gets a line saying what question it answers, so the folder can be read by
somebody who does not yet know what they are looking for.

Three conventions hold across all of them, and are worth knowing before you open
any of them:

- **They describe what is real, not what is planned.** Where something is not
  built, the document says so and says why, rather than describing an intention
  in the present tense. `LIVE_DATA.md` and `CACHING_STRATEGY.md` both have
  explicit "not built" sections that are load-bearing, not disclaimers.
- **They cite the file.** A claim in one of these documents names the module,
  table, migration or function it is about, so it can be checked rather than
  trusted.
- **They are not the backlog.** Open work lives in `RECOMMENDATIONS.md` and
  `KIVO_NEXT_GEN.md` at the repository root. Decisions live in `DECISIONS.md`.
  Current state lives in `BUILD_STATUS.md`. These are reference documents about
  how the built thing works.

---

## Start here

| Document | What it answers |
|---|---|
| [`DATA_ARCHITECTURE.md`](./DATA_ARCHITECTURE.md) | Where football data comes from, how it is normalized, how it reaches Supabase, and which parts of the target architecture do not exist yet. **The one to read first** if you are touching anything football-shaped. |
| [`STRUCTURAL_SURVEY.md`](./STRUCTURAL_SURVEY.md) | A whole-platform survey: what is genuinely built, what is scaffolding, and where the biggest gaps between "impressive demo" and "product" actually are. |
| [`BACKUP_RESTORE_AND_SEED.md`](./BACKUP_RESTORE_AND_SEED.md) | What protects the live database, how to restore it, and how to fill an empty one with the development seed (`supabase/seed.sql`). **Read before running anything against a database with real data in it.** |

## The football data pipeline

| Document | What it answers |
|---|---|
| [`PROVIDER_ABSTRACTION.md`](./PROVIDER_ABSTRACTION.md) | The `FootballDataProvider` interface, its two real implementations, and the per-provider capability matrix — what each vendor can and cannot actually supply. |
| [`API_FOOTBALL.md`](./API_FOOTBALL.md) | The primary provider in detail: endpoints used, response shapes, normalizers. |
| [`API_QUOTA.md`](./API_QUOTA.md) | How request quota is tracked and protected, including retry/backoff, and what is not tracked. |
| [`CACHING_STRATEGY.md`](./CACHING_STRATEGY.md) | How long data is cached, how freshness is shown to users, and why a formal TTL-by-volatility tiering policy does not exist yet. |
| [`LIVE_DATA.md`](./LIVE_DATA.md) | Realtime distribution of already-synced updates, and the checklist that gates automated live polling. |

## The engines

| Document | What it answers |
|---|---|
| [`RATING_ENGINE.md`](./RATING_ENGINE.md) | How a player rating is computed from verified match data, and which inputs it refuses to guess at. |
| [`FANTASY.md`](./FANTASY.md) | The fantasy scoring model: rules, versioning, and why every point is traceable to a real match fact. |
| [`HEATMAP_ENGINE.md`](./HEATMAP_ENGINE.md) | The positional-data seam and the heatmap engine built against it — including the fact that no current provider supplies the data it consumes. |
| [`AI_COPILOT.md`](./AI_COPILOT.md) | How the Copilot is grounded: what goes into its context, and the fact/calculated-insight distinction that keeps it from inventing football. |

## Operations

| Document | What it answers |
|---|---|
| [`ACCOUNT_RECOVERY.md`](./ACCOUNT_RECOVERY.md) | The operator runbook for `/support` and `/admin/support` — for whoever is on support duty. |
| [`EMAIL_DELIVERABILITY.md`](./EMAIL_DELIVERABILITY.md) | Everything still needed for real email delivery. Written for the founder: every remaining step is a dashboard or DNS action no code session can take. |
| [`BUG_AUDIT_2026-08-18.md`](./BUG_AUDIT_2026-08-18.md) | A dated adversarial read of the platform, executed against a frozen commit and real SQL. A record of a specific audit, not a living document. |
| [`email-templates/`](./email-templates) | The Supabase Auth email templates, as they should be pasted into the dashboard. |

---

## Where the other documents live

Not everything is in `docs/`, and the split is deliberate — root-level documents
change constantly and are read by everyone; these are reference material.

| At the repository root | What it is |
|---|---|
| `HANDOFF.md` | The entry point. What is true right now and which document to open for depth. |
| `KIVO_BUILD_ACKNOWLEDGEMENT.md` | The founding brief, in the founder's own terms. |
| `ARCHITECTURE.md` | The application's own shape: routes, layers, auth, RLS. |
| `BUILD_STATUS.md` | Living status: what is real, what is not, and why. |
| `DECISIONS.md` | Dated records of consequential calls and their reasoning. |
| `RECOMMENDATIONS.md` | The running backlog. |
| `KIVO_NEXT_GEN.md` | The forward proposal this pass of work is drawn from. |
| `ENVIRONMENT.md` | Environment variables, and the founder-only steps no code session can perform. |
| `ICON_MANIFEST.md` | Every 3D icon asset and the feature it belongs to. |
