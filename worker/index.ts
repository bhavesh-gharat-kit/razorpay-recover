// Phase 4 will implement the cron polling loop here.
//
// Shape (per CLAUDE.md): a standalone script run as its own PM2 process
// (`worker`, alongside `web`), using `node-cron` to poll a `ScheduledJob`
// table in MySQL via Prisma. No Redis, no BullMQ — the DB is the queue.

console.log("[worker] placeholder — nothing to do yet (see Phase 4).");
