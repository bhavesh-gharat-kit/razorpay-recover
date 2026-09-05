# Route access-control audit

Every route under `app/api/**`, its intended access level, and how the
code actually enforces it. All gating goes through one function —
[`requireRole()`](../lib/auth/requireRole.ts) — which reads the httpOnly
JWT session cookie and checks `session.role` against an allow-list; there
is no second, divergent auth mechanism anywhere in the app. Routes that
don't call it are either genuinely public (`/api/health`), authenticated
by a different mechanism (the Razorpay webhook's HMAC signature), or use
`getSession()` directly because they only need to know *who* is signed in,
not gate on a role (`/api/auth/me`, `/api/auth/logout`).

Verified by reading every route file in this repo on 2026-08-25, not by
inference from naming — see the "Verified" column note below the table
for what "✓" means per row.

| Route                                  | Method | Access             | Verified |
|-----------------------------------------|--------|--------------------|----------|
| `/api/health`                           | GET    | Public             | ✓ |
| `/api/webhooks/razorpay`                | POST   | Razorpay HMAC sig  | ✓ |
| `/api/auth/login`                       | POST   | Public (rate-limited 5/15min/IP) | ✓ |
| `/api/auth/logout`                      | POST   | Public — clears cookie, no-op if not signed in | ✓ |
| `/api/auth/me`                          | GET    | Authenticated (any role) | ✓ |
| `/api/cases`                            | GET    | ADMIN/REVIEWER/VIEWER | ✓ |
| `/api/cases/[id]`                       | GET    | ADMIN/REVIEWER/VIEWER | ✓ |
| `/api/cases/[id]/promise-to-pay`        | POST   | ADMIN/REVIEWER    | ✓ |
| `/api/cases/[id]/retry-send`            | POST   | ADMIN/REVIEWER    | ✓ |
| `/api/approvals`                        | GET    | ADMIN/REVIEWER    | ✓ |
| `/api/approvals/[caseId]/approve`       | POST   | ADMIN/REVIEWER    | ✓ |
| `/api/approvals/[caseId]/reject`        | POST   | ADMIN/REVIEWER    | ✓ |
| `/api/approvals/[caseId]/edit-draft`    | PATCH  | ADMIN/REVIEWER    | ✓ |
| `/api/approvals/[caseId]/reclassify`    | POST   | ADMIN/REVIEWER    | ✓ |
| `/api/approvals/[caseId]/mark-recovered`| POST   | ADMIN/REVIEWER    | ✓ |
| `/api/policies`                         | GET    | ADMIN/REVIEWER/VIEWER | ✓ |
| `/api/policies/[id]`                    | PATCH  | ADMIN              | ✓ |
| `/api/audit`                            | GET    | ADMIN/REVIEWER/VIEWER | ✓ |
| `/api/audit/export`                     | GET    | ADMIN/REVIEWER/VIEWER | ✓ |
| `/api/analytics/summary`                | GET    | ADMIN/REVIEWER/VIEWER | ✓ |
| `/api/events/stream`                    | GET    | ADMIN/REVIEWER/VIEWER | ✓ |
| `/api/internal/classify-pending`        | POST   | ADMIN              | ✓ |
| `/api/internal/detect-abandonment`      | GET    | ADMIN              | ✓ |
| `/api/internal/run-orchestrator-tick`   | POST   | ADMIN              | ✓ |

**"Verified" means**: the route file was opened and its first lines after
the handler signature were confirmed to call `requireRole(request, [...])`
(or, for the three rows without it, the specific alternative mechanism
named in the Access column) *before* any state-changing or data-returning
logic runs — not inferred from the filename or a doc comment. No mismatches
were found; every route's actual enforcement matches its intended access
level, so nothing needed fixing in this pass.

Design notes worth recording, not bugs:

- **`/api/internal/*` is ADMIN-only, not a separate shared-secret**. An
  earlier design used `INTERNAL_TASK_SECRET`; as of Phase 7 these routes
  require an ADMIN session cookie like everything else. The env var is
  kept in `.env.example` only for backward compatibility with older deploy
  notes and is unused by the app — see the comment on it there.
- **`VIEWER` is genuinely read-only**. It's included on every `GET` that
  lists/reads cases, policies, audit, and analytics, and excluded from
  every `POST`/`PATCH` that mutates anything (approvals, promise-to-pay,
  retry-send, policy edits, internal triggers).
- **`/api/policies/[id]` PATCH is ADMIN-only, not ADMIN/REVIEWER** —
  deliberate: a REVIEWER can act on individual cases (approve/reject/
  reclassify) but changing a guardrail like `maxAttempts` or a cooldown
  window affects every future case system-wide, so it's scoped tighter.
- **Webhook idempotency doubles as its access control**: since
  `/api/webhooks/razorpay` has no session (it's Razorpay calling in, not
  a browser), the HMAC signature check is the only gate, and a duplicate
  event ID is short-circuited to `duplicate_ignored` before any handler
  runs — see `lib/ingestion/verify-signature.ts` and the idempotency
  section below.

## Webhook idempotency

`scripts/simulate-webhooks.ts` sends a batch of synthetic Razorpay events,
then re-sends a subset as exact duplicates and one with a tampered/missing
signature, and asserts: unique events are accepted once each, duplicates
are recognized and ignored (no duplicate `RecoveryEvent`/`Case` rows), and
both an invalid and a missing signature are rejected with 401.

Re-run anytime with:

```bash
npm run simulate:webhooks
```

This was last run locally against `npm run dev` and passed: all
unique events accepted, all duplicates ignored, invalid and missing
signatures both rejected. Re-run it again against the real deployed URL
once one exists, by pointing the script's `ENDPOINT` at
`https://<your-domain>/api/webhooks/razorpay` — the check is
environment-agnostic, it only depends on the webhook route being
reachable and configured with the same `RAZORPAY_WEBHOOK_SECRET`.

## Secrets audit

Ran on 2026-08-25: `grep -rnE` across the working tree for
`password|secret|api.?key` assigned to a literal string, plus
`git log -p --all | grep -iE "password=|secret=|api.?key="`, plus a
targeted scan for Razorpay's `rzp_test_`/`rzp_live_` key prefix across
both the working tree and full git history.

**Result: no secrets found**, committed now or in history. What the
grep did surface, all intentional and non-sensitive:
- `demoPassword = "recover123"` in `prisma/seed.ts` — the shared password
  for the three seeded demo users (`admin@`/`reviewer@`/`viewer@recover.local`).
  This is synthetic demo-login convenience for local dev and the
  buildathon judge, not a production credential; a real pilot deployment
  would seed zero demo users (see "PII assessment" below on production
  seed strategy).
- `TEST_SECRET = "whsec_test_secret_for_unit_tests"` — a fixture constant
  in the webhook signature-verification test suite, not a real Razorpay
  webhook secret.
- Every other match was `.env.example`'s documented-empty placeholders or
  `process.env.X` / `lib/env.ts` variable *names*, not values.

`.env` is in [`.gitignore`](../.gitignore) (`# env files — never commit
real secrets, only .env.example`) and `git ls-files` confirms it has
never been tracked — only `.env.example` (all placeholder values) is.
Nothing needed rotating.

## PII assessment

**What PII exists**: `Customer.name`, `Customer.email`, `Customer.phone`
(the recovery target — the person being messaged), and `User.email` (staff
login identity, not a customer). `RecoveryEvent.rawPayload` (a JSON blob of
the original webhook payload) and `AuditLog.afterState` (JSON snapshots,
including login attempts' `{ email, ip }`) can also carry the same fields
incidentally, since they store real request/response data rather than a
filtered subset.

**This deployment (buildathon submission)**: all `Customer` rows are
synthetic, generated by `prisma/seed.ts` — no real customer data has ever
entered this system. No field-level encryption, masking, or redaction was
added; email/phone are stored as plain `String` columns like every other
field, matching the "single MySQL source of truth, no manually maintained
duplicate types" principle in the project conventions. This is accurate
for what exists — it should not be read as more security work than was
actually done.

**Known limitation — what a real pilot would need before handling real
customer data**:
- Field-level encryption at rest for `Customer.email` and `Customer.phone`
  (e.g. application-level encryption before the Prisma write, or MySQL's
  column-level encryption), since a MySQL dump today is plaintext PII.
- A data retention policy — how long a `Customer`/`RecoveryEvent` row
  survives after a case resolves, and a deletion/anonymization job to
  enforce it (nothing like this exists; rows are kept indefinitely).
- Scoping `AuditLog.afterState` and `RecoveryEvent.rawPayload` to exclude
  or redact PII fields before they're written, since audit trails
  typically need a longer retention window than the PII itself should
  have.
- A documented basis for processing (consent/contract) per applicable
  data-protection law, which is a product/legal decision, not a code
  change — out of scope here but worth flagging as unresolved.
