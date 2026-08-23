// PM2 process definitions. Two processes, one codebase, one deploy — see
// CLAUDE.md ("No Redis, no BullMQ" / "Two PM2 processes total").
//
// Not run yet in this phase — this is config-only scaffolding for
// Phase 10 (Deployment, Hardening & Demo Rehearsal). To use it later:
//   pm2 start ecosystem.config.js
//
// `web` serves the Next.js app (build first with `npm run build`).
// `worker` runs the node-cron polling loop against the ScheduledJob table
// (Phase 4), executed directly from TypeScript via `tsx` — no separate
// compile step, same repo, same deploy.

module.exports = {
  apps: [
    {
      name: "web",
      script: "npm",
      args: "run start",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
    },
    {
      name: "worker",
      script: "node_modules/.bin/tsx",
      args: "worker/index.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
    },
  ],
};
