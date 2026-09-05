# Operations

Runbook for operating a deployed Recover instance: shipping an update,
creating admin users, running things manually, reading logs, backups, and
rotating secrets. Assumes the PM2 + Nginx + Ubuntu VPS deployment shape
described in `deploy/provision.sh` and `deploy/nginx.conf`.

## Deploy an update

```bash
cd /home/deploy/recover
git pull
npm ci --production=false   # devDependencies are needed for the build step
npx prisma migrate deploy   # NOT `migrate dev` — no shadow DB in production
npm run build
pm2 restart ecosystem.config.js --env production
pm2 save
```

`pm2 restart` reloads both the `web` and `worker` processes from the same
`ecosystem.config.js` — there's nothing separate to restart for the
worker. Check `pm2 status` afterward; both should show `online` with a
fresh uptime.

## Create a new admin user

```bash
npm run create:admin -- --email=you@example.com --password='a-strong-password'
```

(Or run it with no flags for an interactive prompt, password input
hidden.) `scripts/create-admin-user.ts` always creates/promotes to
ADMIN — there's no REVIEWER/VIEWER flag and no dashboard user-management
UI (out of scope so far; a known limitation). To create
a REVIEWER or VIEWER user, use `npx prisma studio` and edit the `User`
table directly, or insert one via `prisma.user.create()` in a one-off
script the same way `prisma/seed.ts` creates its three demo users.
Passwords are bcrypt-hashed before storage; there's no way to recover a
lost password, only reset it by running this script again for the same
email (it's an upsert, min 8 characters).

## Run a manual worker tick

Two ways, both do the same detect → classify → decide → execute pass the
cron loop does every 60 seconds:

- **From the dashboard**: sign in as ADMIN, click "Run Batch" on the
  Summary page. Useful for a demo — the response updates the page
  immediately, and the `batch_summary` SystemEvent it emits arrives a
  moment later over SSE.
- **From the CLI**, against a running `web` process:
  ```bash
  curl -s -X POST https://<your-domain>/api/internal/run-orchestrator-tick \
    -H "Cookie: recover_session=<admin session cookie>"
  ```
  (Needs a valid ADMIN session cookie — log in via `/api/auth/login`
  first and reuse the `Set-Cookie` value, or just use the dashboard
  button above.)

The `worker` PM2 process runs this same pipeline automatically every
60 seconds — the manual trigger exists for demos and debugging, not as a
replacement for the cron loop.

## Logs

```bash
pm2 logs                 # both processes, tailed live
pm2 logs web              # just the Next.js app
pm2 logs worker           # just the cron poller
```

Or read the files directly — `ecosystem.config.js` points both processes
at predictable paths under `~/.pm2/logs/`:

```bash
tail -f ~/.pm2/logs/recover-web-out.log
tail -f ~/.pm2/logs/recover-worker-out.log
tail -f ~/.pm2/logs/recover-web-error.log
tail -f ~/.pm2/logs/recover-worker-error.log
```

Lines are structured JSON (via `pino` — see `lib/logger.ts`) in
production, one object per line. Pipe through `jq` to filter, e.g. every
error touching a specific case:

```bash
tail -f ~/.pm2/logs/recover-worker-out.log | jq -c 'select(.caseId == "cm...")'
```

`LOG_LEVEL` (see `.env.example`) controls verbosity — `info` in
production by default, `debug` if you need more while chasing something
down (`pm2 restart` after changing it).

## Backup and restore

**Manual backup:**

```bash
./deploy/backup.sh
```

Writes a gzipped `mysqldump` to `/var/backups/recover/recover_<timestamp>.sql.gz`
and prunes anything older than 7 days. The same script runs automatically
every day at 2am via system crontab — see `deploy/backup.sh`'s header
comment for the exact `crontab -e` line, and confirm it's installed with
`sudo crontab -l`.

**Restore:**

```bash
gunzip -c /var/backups/recover/recover_<timestamp>.sql.gz | \
  mysql -u recover -p recover_prod
```

If restoring into a fresh box where the database doesn't exist yet,
create it first (`CREATE DATABASE recover_prod ...` — see
`deploy/provision.sh` step 8), then run the command above.

**Where backups live**: `/var/backups/recover/` on the VPS, 7 rolling
daily copies. Nothing is currently shipped off-box (S3, etc.) — for a
real pilot beyond the buildathon, add an `aws s3 cp` (or equivalent) line
to `deploy/backup.sh` after the dump completes, so a VPS-level disaster
doesn't take the backups with it.

## Rotate secrets

All secrets live in `.env` on the VPS (never committed — see
`.env.example` for the full list with descriptions). To rotate one:

1. Generate the new value (`openssl rand -hex 32` for `JWT_SECRET`; the
   provider's dashboard for API keys).
2. Update `.env` on the VPS.
3. `pm2 restart ecosystem.config.js --env production` to pick it up —
   env vars are read once at process start, not live-reloaded.

**`JWT_SECRET`**: rotating this invalidates every existing session
immediately — every signed-in user gets logged out. Fine to do anytime;
there's no session migration to worry about.

**`BREVO_API_KEY`**: rotate in the Brevo dashboard (Settings → SMTP &
API), update `.env`, restart. In-flight sends complete or fail on the
old key before the restart; nothing queues across a key rotation since
sends are synchronous within a single orchestrator action.

**`RAZORPAY_KEY_SECRET`** / **`RAZORPAY_WEBHOOK_SECRET`**: rotate in the
Razorpay dashboard. If you rotate `RAZORPAY_WEBHOOK_SECRET`, update the
webhook's configured secret in the Razorpay dashboard *and* `.env` in the
same maintenance window — a mismatch makes every incoming webhook fail
signature verification (401) until both sides agree again.

**`ANTHROPIC_API_KEY`**: only relevant if `USE_LLM_DRAFTING=true`. Rotate
in the Anthropic Console; the template-first drafting path is unaffected
either way.
