# Architecture

Recover is an AI-assisted revenue recovery agent for Razorpay merchants.
It detects at-risk transactions, classifies why the money didn't come in,
decides a bounded recovery action, drafts an outreach message, sends it
through a pluggable channel, and logs everything to an append-only audit
trail — all within a single codebase.

## High-level pipeline

```
detect  →  classify  →  decide  →  send  →  recover
```

Every recovery case flows through the same five-stage pipeline regardless
of scenario. The stages run inside a single orchestrator tick
(`lib/orchestrator/orchestrator.ts`) that the worker process fires every
60 seconds:

1. **Detect** — a Razorpay webhook creates a `RecoveryEvent` and opens a
   `Case`. For checkout abandonment, a grace-period sweep
   (`lib/ingestion/detect-abandonment.ts`) checks the `OrderTracking`
   table for orders that never moved to `PAID` or `FAILED` within the
   configured grace window.
2. **Classify** — `lib/classification/classify.ts` determines the cause
   code. A deterministic rule table (`lib/classification/rules.ts`)
   handles known Razorpay error codes first. Only genuinely ambiguous
   cases fall back to local embedding similarity
   (`lib/classification/embeddings.ts`, `all-MiniLM-L6-v2` via
   `@huggingface/transformers`, in-process, no GPU). Below-threshold
   matches are sent to human review, never guessed.
3. **Decide** — the orchestrator looks up the matching `RecoveryPolicy`
   row for the case's `(scenario, causeCode, escalationTier)` tuple and
   checks guardrails: cooldown period, max attempts, contact cap,
   business-hour send window, human-review amount threshold, and
   promise-to-pay pause. If any guardrail fires, the case is parked with
   a specific reason code; otherwise, a Razorpay Payment Link is created
   via `lib/razorpay/client.ts`.
4. **Send** — a message is drafted (`lib/messaging/`), template-first by
   default, optionally LLM-assisted when `USE_LLM_DRAFTING=true`. The
   draft is delivered through a pluggable channel adapter
   (`lib/channels/`); today that's Brevo transactional email.
5. **Recover** — when the customer pays via the Payment Link, Razorpay
   sends a `payment_link.paid` webhook. The webhook handler closes the
   loop, moving the case to `RECOVERED` automatically.

Every stage writes a `CaseTransition` row (the state-machine log) and an
`AuditLog` entry (append-only, never updated or deleted), so the full
detect-to-recovered story is always reconstructable.

## System shape

```
┌──────────────────────────────────────────────────┐
│                  Single codebase                 │
│                                                  │
│  ┌──────────────┐       ┌─────────────────────┐  │
│  │  Next.js 14  │       │  Worker (node-cron)  │  │
│  │  App Router  │       │  worker/index.ts     │  │
│  │  (PM2: web)  │       │  (PM2: worker)       │  │
│  ├──────────────┤       ├─────────────────────┤  │
│  │ Dashboard UI │       │ Every 60s:          │  │
│  │ API routes   │       │  detect-abandonment  │  │
│  │ Webhooks     │       │  classify-pending    │  │
│  │ SSE stream   │       │  orchestrator tick   │  │
│  └──────┬───────┘       └──────────┬──────────┘  │
│         │                          │             │
│         └──────────┬───────────────┘             │
│                    │                             │
│            ┌───────▼────────┐                    │
│            │  MySQL/Prisma  │                    │
│            │  (all tables)  │                    │
│            └────────────────┘                    │
└──────────────────────────────────────────────────┘
         │              │              │
    Razorpay API    Brevo API    Claude API
    (Payment Links, (email)      (optional LLM
     webhooks)                    drafting)
```

Two PM2 processes, one MySQL database, one codebase, one deploy.

## Three scenarios, one engine

All three recovery scenarios share the same pipeline, the same
orchestrator, the same worker loop, and the same dashboard. They differ
only in their cause codes, recovery policies, and message templates:

- **Checkout Drop-off** — payment failed or checkout abandoned.
  Cause codes: `INSUFFICIENT_FUNDS`, `CARD_EXPIRED`, `GATEWAY_TIMEOUT`,
  `OTP_ABANDONED`, `CHECKOUT_ABANDONED`, etc. Recovery action: Payment
  Link + email.
- **Subscription Failure** — recurring charge failed.
  Cause codes: `SUB_INSUFFICIENT_FUNDS`, `MANDATE_LAPSED`,
  `MANDATE_EXPIRED_CARD`, etc. Key distinction: a lapsed mandate needs
  re-authorization, not a retry — the template copy and cause code reflect
  this.
- **Invoice Overdue** — B2B invoice unpaid past its due date.
  Cause code: `INVOICE_OVERDUE`. Escalates across three tiers as
  days-overdue grows (friendly nudge → firm reminder → escalated to
  human), controlled by `escalationTier` on `RecoveryPolicy` rows.
  Supports a promise-to-pay guardrail that pauses escalation when a
  customer commits to a future payment date.

## Data model (key entities)

All persistence is in MySQL via Prisma. The schema
(`prisma/schema.prisma`) is the single source of truth.

| Model | Role |
|---|---|
| `Merchant` | Razorpay merchant account linked to the system |
| `Customer` | Unique per merchant (deduplicated by email) |
| `RecoveryEvent` | Raw inbound event from a webhook or sweep |
| `ClassifiedCase` | Classification result (cause code + confidence + source) |
| `Case` | Central state machine — tracks the full lifecycle |
| `CaseTransition` | State-change log (from → to + reason + actor) |
| `RecoveryPolicy` | Per-cause-code guardrails (cooldown, max attempts, send window, tier) |
| `DraftMessage` | Generated message (template or LLM), tied to a case |
| `DeliveryAttempt` | Channel send result (status, provider ref, error detail) |
| `ScheduledJob` | MySQL-backed job queue (replaces Redis/BullMQ) |
| `AuditLog` | Append-only audit trail (never updated or deleted) |
| `SystemEvent` | Cross-process signal for the SSE real-time feed |
| `OrderTracking` | Checkout lifecycle tracker for abandonment detection |
| `User` | Dashboard auth (JWT sessions, `ADMIN`/`REVIEWER`/`VIEWER` roles) |

Money fields are stored as integers in the smallest currency unit (paise).

## Classification strategy

```
known Razorpay error code?
  ├── yes → deterministic rule table → cause code (confidence 1.0)
  └── no  → local embedding similarity (all-MiniLM-L6-v2)
              ├── above threshold → cause code (confidence 0.x)
              └── below threshold → human review (never a guess)
```

The rule table covers the common, well-defined failure codes. The
embedding fallback handles ambiguous or unusual descriptions by comparing
them against a curated set of reference texts per cause code. No external
API is called; the model runs in-process via `@huggingface/transformers`.

## Guardrails

The orchestrator checks these before executing any recovery action:

- **Cooldown** — minimum time between contacts for a given cause code
- **Max attempts** — hard cap on recovery attempts per case
- **Contact cap** — max outbound messages to one customer per calendar day
- **Business-hour send window** — messages only send between configurable
  IST hours (default 9am–9pm)
- **Human-review amount threshold** — cases above a configurable amount
  (default ₹5,000) require manual approval before sending
- **Promise-to-pay pause** — a logged promise-to-pay date pauses
  escalation until that date passes
- **Escalation tiers** (Invoice Overdue only) — tone and action escalate
  through three tiers; tier 3 always escalates to a human

All guardrails are stored as database rows (`RecoveryPolicy`), editable
from the dashboard's Policy Settings page (ADMIN only), and take effect
on the next orchestrator tick with no restart.

## Message generation

Template-first by default. Every fact (customer name, merchant name,
amount, recovery link) is injected via TypeScript template literals from
validated case data — never hallucinated. A defensive
`assertNoLeftoverPlaceholders` check catches any accidentally un-filled
`{{...}}` token before a message ships.

An optional LLM path (Claude API, behind `USE_LLM_DRAFTING=true` +
`ANTHROPIC_API_KEY`) handles tone and phrasing only — all facts are
handed to it as fixed values it must reproduce verbatim. If the LLM
drops the recovery link or fails, it falls back to the template generator
automatically.

## Auth

JWT session tokens stored in an HTTP-only cookie. Three roles:

- **ADMIN** — full access, including policy settings and internal endpoints
- **REVIEWER** — can approve/reject cases in the approval queue
- **VIEWER** — read-only dashboard access

Login is rate-limited (5 attempts per IP per 15 minutes). Passwords are
bcrypt-hashed.

## Deployment

- **Runtime**: PM2 manages two processes (`web` + `worker`) from one
  `ecosystem.config.js`
- **Reverse proxy**: Nginx with rate limiting on webhook and login
  endpoints, SSE support, security headers
- **TLS**: Certbot (Let's Encrypt)
- **Target**: self-managed Ubuntu VPS
- **Backup**: daily mysqldump via `deploy/backup.sh`, 7-day rolling
  retention

## Key file map

```
app/
  api/
    analytics/summary/     Summary stats endpoint
    approvals/             Human review queue endpoints
    audit/                 Audit log + CSV export
    auth/                  Login, logout, session check
    cases/                 Case CRUD + promise-to-pay + retry-send
    demo/                  Live checkout demo endpoints
    events/stream/         SSE real-time feed
    health/                Health check
    internal/              Worker-facing endpoints (classify, detect, tick)
    policies/              Recovery policy CRUD
    webhooks/razorpay/     Razorpay webhook receiver
  (dashboard)/             Dashboard pages (cases, approvals, audit, etc.)
  (demo)/                  Live checkout demo page
  login/                   Login page

lib/
  analytics/               Summary computation
  api/                     Standard response envelope + fetch client
  approval/                Approval queue logic
  audit/                   Audit log timeline builder
  auth/                    JWT, password hashing, session, rate limiting, RBAC
  channels/                Pluggable channel adapters (Brevo email, SMS stub)
  classification/          Rules engine + embedding fallback
  demo/                    Live demo pipeline
  events/                  SSE event emission
  ingestion/               Webhook signature verification, abandonment detection
  messaging/               Template + LLM message generators
  orchestrator/            Core recovery pipeline + guardrails
  razorpay/                Razorpay API client (Payment Links)

worker/index.ts            Standalone cron worker (every 60s)
prisma/schema.prisma       Data model (single source of truth)
prisma/seed.ts             Synthetic seed data across all three scenarios
```
