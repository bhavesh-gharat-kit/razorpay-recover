// PM2 process definitions. Two processes, one codebase, one deploy —
// no Redis, no BullMQ; the DB is the job queue.
//
//   pm2 start ecosystem.config.js --env production
//   pm2 save && pm2 startup   # survive a VPS reboot
//
// `web` serves the Next.js app (build first with `npm run build`).
// `worker` runs the node-cron polling loop against the ScheduledJob table
// (Phase 4), executed directly from TypeScript via `tsx` — no separate
// compile step, same repo, same deploy.
//
// Logging (Phase 10): both processes log structured JSON via `pino`
// (lib/logger.ts) to stdout/stderr, which PM2 writes to the files below.
// `merge_logs: true` interleaves cluster-instance output into one file
// (moot at `instances: 1`, but harmless and future-proof); the explicit
// `_file` paths make `pm2 logs` and `tail -f` point at a predictable
// location instead of PM2's default `~/.pm2/logs/<name>-<id>-*.log`.
// See docs/operations.md for how to read these in production.

const path = require("path");
const LOG_DIR = path.join(process.env.HOME || ".", ".pm2", "logs");

module.exports = {
  apps: [
    {
      name: "web",
      script: "npm",
      args: "run start",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        // `next start` binds to process.env.PORT; set it here rather than
        // relying on .env so the listen port is deterministic under PM2.
        PORT: 3000,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: path.join(LOG_DIR, "recover-web-out.log"),
      error_file: path.join(LOG_DIR, "recover-web-error.log"),
    },
    {
      name: "worker",
      script: "node_modules/.bin/tsx",
      // `next start` auto-loads .env; a bare `tsx` process does not, so the
      // worker needs it passed explicitly or lib/env.ts throws on boot.
      args: "--env-file=.env worker/index.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: path.join(LOG_DIR, "recover-worker-out.log"),
      error_file: path.join(LOG_DIR, "recover-worker-error.log"),
    },
  ],
};
