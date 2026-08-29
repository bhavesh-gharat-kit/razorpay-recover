# Recover

Recover is an AI-assisted revenue recovery agent for Razorpay merchants.
It watches for at-risk transactions, works out *why* the money didn't
come in, and runs a bounded, auditable recovery flow — a real Payment
Link and a drafted outreach message, not a guess — without needing a
human in the loop for the common cases.

Built for the Razorpay AI Buildathon (Track 03: AI Revenue Recovery).

## The three recovery scenarios

One engine, three cause-code families — not three separate systems:

- **Checkout Drop-off** — a customer starts checkout and never completes
  it, or a payment attempt fails (insufficient funds, expired card,
  gateway timeout, OTP abandoned). Recovery: a real Razorpay Payment Link
  by email/SMS.
- **Subscription Failure** — a recurring charge fails (insufficient
  funds, an expired card on file, or a lapsed UPI Autopay/e-mandate).
  Recovery differs by cause: a lapsed mandate gets asked to
  **re-authorize**, not "try again" — a retry can't fix an authorization
  that no longer exists.
- **Invoice Overdue** — a B2B invoice goes unpaid past its due date.
  Recovery escalates in tone across three tiers as days-overdue grows
  (friendly nudge → firm reminder → escalated to a human), with a
  promise-to-pay guardrail that pauses escalation when a customer commits
  to a future payment date.

## How it works

```
detect  →  classify  →  decide  →  send  →  recover
```

1. **Detect** — a Razorpay webhook (or, for checkout, a grace-period
   abandonment sweep) creates a `RecoveryEvent` + `Case`.
2. **Classify** — a deterministic rule table matches known Razorpay error
   codes to a cause code first; only genuinely ambiguous cases fall back
   to local embedding similarity. Below-threshold matches go to human
   review instead of a guess — classification never fabricates an answer.
3. **Decide** — the orchestrator picks a bounded action from that cause
   code's `RecoveryPolicy` (cooldown, max attempts, allowed actions,
   business-hour send window), or escalates to a human when a guardrail
   says stop.
4. **Send** — a real Razorpay Payment Link is created, a message is
   drafted (template-first, optionally LLM-assisted), and it goes out
   through a pluggable channel adapter (Brevo email today).
5. **Recover** — the customer pays; the `payment_link.paid` webhook closes
   the loop and moves the case to `RECOVERED` automatically. Every step
   along the way writes an `AuditLog` entry, so the full detect →
   recovered story is always reconstructable.

## Tech stack

- **Next.js 14 (App Router)** — one codebase, frontend and backend
  together. API routes under `app/api/**` are the entire backend; there
  is no separate Express service.
- **MySQL + Prisma** — the single source of truth for all persistence,
  including the background job queue and the audit log.
- **No Redis, no BullMQ** — background/delayed work uses a `ScheduledJob`
  table polled by a standalone worker (`worker/index.ts`, `node-cron`),
  run as a second PM2 process from the same repo.
- **`@huggingface/transformers`** (`all-MiniLM-L6-v2`) for the fallback
  embedding classifier — in-process, no external API, no GPU.
- **Anthropic Claude API** — optional, behind `USE_LLM_DRAFTING`, off by
  default.
- **Brevo** — transactional email (free tier).
- **JWT sessions** with an `ADMIN` / `REVIEWER` / `VIEWER` role field —
  no third-party auth provider.
- **`pino`** for structured logging, **Sentry** for error monitoring
  (optional — skipped silently if `SENTRY_DSN` isn't set).
- **PM2 + Nginx + Certbot** on a self-managed Ubuntu VPS — not Vercel,
  not a serverless platform.

## Key design decisions

- **Rules-first, embeddings-second, never a required paid API call.**
  Classification works fully offline; an LLM is never load-bearing for
  the system to function.
- **Template-first messaging.** Variable injection from real case data,
  never hallucinated facts. An LLM can draft optionally, behind a
  swappable `LLMClient` interface, gated by an env flag.
- **No Redis.** A `ScheduledJob` table in the same MySQL database *is*
  the job queue — one fewer moving part to deploy and operate for a
  system this size.
- **Payment Link-based recovery.** The actual money-recovery mechanism is
  a real Razorpay Payment Link, created via the Razorpay API — never a
  hardcoded or made-up URL, falling back to an explicitly-labeled
  placeholder only when Razorpay credentials aren't configured at all.
- **Bounded, auditable actions.** Every guardrail (cooldown, max
  attempts, amount threshold, send window, promise-to-pay pause) lives in
  a `RecoveryPolicy` DB row the orchestrator reads fresh every tick, and
  every decision writes a reason the audit trail can render — favor a
  few extra log lines over cleverness.

## Running locally

```bash
npm install
cp .env.example .env          # fill in DB + API credentials — see the
                               # file's own comments for what each key is
npx prisma migrate dev
npx prisma db seed             # synthetic merchants/customers/cases across
                                # all three scenarios
npm run dev                    # Next.js app on :3000
npm run worker                 # in a second terminal — the cron poller
```

`GET /api/health` confirms the app is up and the database is reachable.
Sign in at `/login` with one of the seeded demo users
(`admin@recover.local` / `recover123`, or `reviewer@` / `viewer@` with
the same password) to reach the dashboard.

```bash
npm test                       # Vitest suite
npm run lint                   # ESLint
npm run simulate:webhooks      # fires synthetic Razorpay webhooks at a
                                # running instance, including duplicates
                                # and bad signatures, to check idempotency
```

## Deployment

PM2 + Nginx on a self-managed Ubuntu VPS, HTTPS via Certbot. See
[`deploy/provision.sh`](deploy/provision.sh) for first-time VPS setup,
[`deploy/nginx.conf`](deploy/nginx.conf) for the reverse-proxy config
(rate limiting on the webhook and login endpoints, SSE support, security
headers), [`ecosystem.config.js`](ecosystem.config.js) for the two PM2
processes (`web`, `worker`), and [`docs/operations.md`](docs/operations.md)
for the day-to-day runbook — deploying an update, reading logs, backups,
and secret rotation.

## Demo

[`docs/demo-script.md`](docs/demo-script.md) has the full click-by-click
walkthrough (under 10 minutes), known-good reference numbers, and a
fallback plan.

## Project layout

```
app/            Next.js App Router — dashboard pages + API routes
lib/            core domain logic (ingestion, classification, orchestrator,
                messaging, channels, auth, audit, analytics, observability)
worker/         standalone cron worker (PM2 "worker" process)
prisma/         schema, migrations, seed script
docs/           architecture, operations, demo script, access audit
deploy/         provisioning script, Nginx config, DB backup script
scripts/        one-off CLI tools (admin user creation, webhook simulator, …)
```

Full architecture notes live in
[`docs/architecture.md`](docs/architecture.md).
