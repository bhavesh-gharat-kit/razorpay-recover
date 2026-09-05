# Demo script

A click-by-click walkthrough for presenting Recover, plus a fallback plan
if the live system hiccups mid-demo. Built on top of the pages that exist
today (`app/(dashboard)/**`) — every step below names a real route,
button label, or field, not an aspirational one.

**Target time: under 10 minutes.** Rehearsed locally end-to-end on
2026-08-25 against a fresh seed (see "Known-good numbers" below) —
walking through all 10 steps at a narrating pace took about 8 minutes.
Re-time it once more against the actual deployed instance before
presenting; local timing is a close proxy but not identical (network
latency to a real VPS, cold-start on first page load).

## Walkthrough

1. **Login** — go to `/login`, sign in as `admin@recover.local` /
   `recover123`. Lands on Summary (`/`).

2. **Headline numbers** — point out the stat row: total at risk, total
   recovered, recovery rate, avg time-to-recovery. These come from
   `GET /api/analytics/summary`, computed live off the `Case` table, not
   cached or hardcoded.

3. **Scenario filter** — use the scenario dropdown (All scenarios /
   Checkout Drop-off / Subscription Failure / Invoice Overdue) to show
   the same four numbers recompute per-scenario. This is the moment to
   say the three scenarios share one engine — same classifier, same
   orchestrator, same worker loop, just different cause codes and
   templates — different cause codes and recovery policies, same engine.

4. **Run Batch** — click **Run Batch** on Summary. Narrate: this
   triggers one full detect → classify → decide → execute pass
   synchronously (the same pipeline the `worker` PM2 process runs every
   60 seconds on its own). The click's own response updates the "Last
   tick" line immediately; the `batch_summary` SystemEvent it emits
   lands a moment later over SSE and animates the stat cards — point at
   the green "Live" connection dot as it happens.

5. **Case Explorer, a recovered checkout case** — go to **Cases**,
   filter `State = RECOVERED` (add `Scenario = Checkout Drop-off` if more
   than one type shows). Click into one. Walk the audit timeline
   top-to-bottom as a story: detected → classified (rule or embedding,
   with confidence) → Payment Link created → email drafted → email sent
   → customer paid → case auto-recovered. Expand one entry's "Show
   details" to reveal the raw JSON backing it — this is the same
   `AuditLog` row a real support/compliance review would read.

6. **A subscription case** — filter `Scenario = Subscription Failure`,
   open a `MANDATE_LAPSED` case. Show the draft message: it asks the
   customer to **re-authorize** their payment method, and explicitly
   does *not* say "try again" — a lapsed UPI Autopay/e-mandate needs a
   fresh authorization, not a retry, and the template copy reflects
   that distinction on purpose (see the classification rules test suite
   for the exact assertion).

7. **An invoice case, tier 2, with promise-to-pay** — filter
   `Scenario = Invoice Overdue`, open a case at escalation Tier 2 (the
   detail page's field row shows the tier — "Tier 2 — Firm reminder" —
   computed from days overdue). Show the tone shift from Tier 1's
   friendly nudge to Tier 2's firm reminder is real template copy, not a
   label change. Click **Log Promise to Pay**, pick a near-future date,
   save — show the case now reads "⏸️ Paused until …" and explain
   escalation won't advance past this tier again until that date passes
   (or the promise is fulfilled).

8. **Approval Queue** — go to **Approvals** (badge on the sidebar shows
   the queue count). Open a case parked here — either low classification
   confidence or an amount over the ₹5,000 human-review threshold, both
   shown on the row. Click **Approve**. Watch it leave the queue and the
   sidebar badge count drop by one.

9. **Policy Settings** — go to **Policies** (ADMIN-only — mention a
   REVIEWER wouldn't see this nav item at all, and a VIEWER sees
   everything read-only). Change a policy's `maxAttempts` or
   `cooldownMinutes`, click **Save**. Explain: this takes effect on the
   *next* orchestrator decision for that cause code — no redeploy, no
   restart, because policies are DB rows the orchestrator reads fresh
   every tick, not a config file baked into the build.

10. **Close on Summary** — navigate back to `/`, scenario filter back to
    "All scenarios". Close on the recovery rate and avg time-to-recovery
    numbers as the headline takeaway.

## Known-good numbers

Captured 2026-08-25 against a fresh `npx prisma db seed` + a few manual
orchestrator ticks, run locally. Use these as the numbers to
speak to if the live system is showing something odd mid-demo, or if
running live isn't possible at all:

- **103 cases detected** — 55 Checkout Drop-off + 28 Subscription Failure
  + 20 Invoice Overdue, ₹15,00,313.99 total at risk.
- After one orchestrator tick: all 103 classified; 5 reached
  `ACTION_SENT` with **real Razorpay test-mode Payment Links** (e.g.
  `https://rzp.io/rzp/...`, not placeholders — `RAZORPAY_KEY_ID`/
  `RAZORPAY_KEY_SECRET` are configured) and a drafted+sent email each;
  98 stayed at `DIAGNOSED`, mostly B2B invoice cases parked at
  `pending_human_approval` because their amounts exceed the ₹5,000
  review threshold (expected — most invoice amounts in this seed are
  large B2B receivables), plus checkout/subscription cases outside the
  send window or cooldown at the moment of the tick.
- One `ACTION_SENT` case manually marked recovered via the Approval
  Queue's **mark-recovered** action (₹1,816.53) to verify that path end
  to end: `totalRecoveredPaise: 181653`, `recoveryRate: 0.12%`,
  `avgTimeToRecoveryMinutes: 1.87`.
- **Reaching RECOVERED at scale requires either a real customer payment
  via the Payment Link** (proven separately: `npm run simulate:webhooks`
  passes 18/18 unique events accepted, 3/3 duplicates ignored, both bad
  signatures rejected — see `docs/route-access-audit.md`) **or running
  the worker continuously across real elapsed time**, since cooldowns
  (up to 2 days for subscription causes) and business-hour send windows
  are real wall-clock delays by design, not something a single seed +
  tick can fast-forward through. For a demo, seed a day or more ahead of
  presenting and let the `worker` PM2 process run continuously so more
  cases have organically reached `ACTION_SENT`/`RECOVERED` by showtime.

## Fallback plan

- **Screen recording**: record a full run-through of the 10 steps above
  (OBS or similar) against a healthy local or deployed instance ahead of
  time, and have the file ready to play if the live system is down or
  misbehaving. *(Not yet recorded as of this writing — do this in the
  same sitting as the next full rehearsal, immediately before presenting,
  so the recording matches whatever numbers are live then.)*
- **Speak to the numbers above** if live demo isn't possible at all —
  they're real, reproducible output from this exact codebase, not
  invented figures.
- **Local dev fallback**: `npm run dev` + `npm run worker` in a second
  terminal reproduces the whole system locally without any VPS
  dependency — already how every phase of this project has been
  developed and verified. Keep a terminal with both running as a live
  backup even when presenting from the deployed URL.
- **If Brevo is down**: the pipeline still demonstrates itself fully —
  cases still classify, get real Payment Links, and get drafted
  messages; `DeliveryAttempt` rows record the send intent and Brevo's
  actual HTTP response (or failure) rather than silently skipping, so
  the audit trail still tells the whole story even if the email never
  left Brevo's side.

## Live checkout demo (`/demo`)

An unauthenticated page at `/demo` opens a real Razorpay test-mode
Checkout, catches the failure/abandonment, and shows the recovery
pipeline running on that live event. Use this when a judge wants to
prod the system rather than watch a walkthrough of pre-seeded data.

**Requires**: `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`,
`RAZORPAY_ACCOUNT_ID` set to your test account (then run
`npm run link-demo-merchant` once), `RAZORPAY_WEBHOOK_SECRET` (register
the webhook URL in the Razorpay dashboard for `payment.failed`,
`payment.captured`, `order.paid`), and Brevo (`BREVO_API_KEY` +
`BREVO_SENDER_EMAIL`) if you want the email to actually leave.

### Click path

1. Open `/demo` in a browser.
2. Enter an email (yours, if you want to see the real drafted mail land),
   optional name, and an amount between ₹1 and ₹10,000.
3. Pick a scenario:
   - **Failed payment** — Checkout opens, complete it and choose
     **Failure** on Razorpay's simulated success/failure screen.
     Refer to Razorpay's current *Test Card Details* docs for the test
     card number a card-method flow prompts for (numbers change; don't
     hardcode).
   - **Abandoned checkout** — Checkout opens; close the modal (or
     the browser tab) without paying.
4. The timeline below the form appears within a few seconds and
   updates through: detected → classified (cause + confidence) →
   payment link created → email drafted → email sent.

### Expected timeline entries (failed path, ₹499)

- `event_ingested` (SYSTEM → DETECTED)
- `classification_succeeded` — `INSUFFICIENT_FUNDS` / `CARD_EXPIRED` /
  etc. depending on the error code the test failure produced, with a
  confidence around 0.9+
- `action_scheduled` — with the Razorpay Payment Link id
- `draft_created` — TEMPLATE, EMAIL
- `delivery_attempted` — `SENT` with the Brevo `messageId`, or
  `FAILED` with a specific `errorDetail` if Brevo isn't configured
- Case ends at `ACTION_SENT` (or `RECOVERED` if the visitor then pays
  via the recovery link and the webhook lands)

### Known gotchas

- **Amount ≥ ₹5,000** → the orchestrator parks the case at
  `pending_human_approval` (the `HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE`
  guardrail). The timeline stops at that step by design — approve it
  in the dashboard's Approvals queue to let it proceed. To see the
  full send in the live demo, stay under ₹5,000.
- **Same email 3×/day** → the third send trips
  `MAX_CONTACTS_PER_CUSTOMER_PER_DAY=2` (default) and the case
  transitions with `contact_cap_reached`. Use different emails between
  live-demo runs, or reset the seed.
- **No Brevo keys** → the pipeline still runs to completion; the
  `DeliveryAttempt` row records `status: FAILED` with `errorDetail:
  "Brevo not configured..."` and the timeline shows the delivery
  failure entry, so the audit trail is complete.
- **Real webhook races the client callback** — the real Razorpay
  `payment.failed` webhook that lands moments after the client's
  `/api/demo/result` call is deduped by `razorpayRefId` (the payment
  id), so exactly one case is created. Both paths hand back the same
  case id.
