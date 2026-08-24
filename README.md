# Recover

Recover is a revenue recovery agent for Razorpay merchants. It watches for
at-risk transactions — abandoned checkouts, failed subscription charges,
overdue B2B invoices — classifies why the money didn't come in, decides a
bounded recovery action, drafts an outreach message, sends it through a
pluggable channel, and logs everything to an audit trail.

Built for the Razorpay AI Buildathon (Track 03: AI Revenue Recovery).

## Architecture

- **Single Next.js 14 (App Router) app** — frontend and backend in one
  codebase. API routes under `app/api/**` handle both inbound webhooks and
  internal scheduling triggers.
- **MySQL + Prisma** for all persistence, including the background job
  queue and the audit log.
- **No Redis, no BullMQ.** Background/delayed work uses a `ScheduledJob`
  table polled by a standalone worker script (`worker/index.ts`) on
  `node-cron`, run as a second PM2 process from the same codebase.
- **Classification is rules-first, embeddings-second.** A deterministic
  rule table handles known Razorpay codes; ambiguous cases fall back to
  local embedding similarity (`@huggingface/transformers`,
  `all-MiniLM-L6-v2`, in-process, no external API). Below-threshold matches
  go to human review instead of a guess.
- **Message generation is template-first.** A template engine with
  variable injection is the default and production path. An LLM can
  optionally be used for drafting behind a swappable `LLMClient`
  interface, gated by `USE_LLM_DRAFTING` and off by default — the system
  never depends on a paid API to function.
- **Email channel: Brevo** (free tier) via their transactional email API.
  SMS/WhatsApp adapters share the same `ChannelAdapter` interface.
- **Auth:** JWT sessions with a role field (`ADMIN`, `REVIEWER`, `VIEWER`)
  on the `User` model.
- **Deployment:** self-managed Ubuntu VPS, Nginx reverse proxy, Certbot
  TLS, PM2 process management.

Full architecture notes live in [`docs/architecture.md`](docs/architecture.md).

## Getting started

```bash
npm install
cp .env.example .env   # fill in DB + API credentials
npx prisma migrate dev
npm run dev
```

`GET /api/health` confirms the app is up and the database is reachable.

## Scripts

- `npm run dev` — start the Next.js dev server
- `npm run build` / `npm start` — production build and run
- `npm test` — run the Vitest suite
- `npm run lint` — ESLint

## Project layout

```
app/            Next.js App Router — pages + API routes
lib/            core domain logic (ingestion, classification, orchestrator, etc.)
worker/         standalone cron worker (PM2 "worker" process)
prisma/         schema + migrations
docs/           architecture notes
deploy/         Nginx config reference
```
