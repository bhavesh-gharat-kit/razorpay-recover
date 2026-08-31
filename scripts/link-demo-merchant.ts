/**
 * Point the first seeded merchant (QuickCart India) at your real Razorpay
 * TEST-mode account id, so `payment.failed` webhooks Razorpay sends for
 * your account resolve to a merchant in this database.
 *
 * Idempotent — running it twice with the same env value is a no-op. Runs
 * as `npx tsx scripts/link-demo-merchant.ts` or `npm run link-demo-merchant`.
 */

import { PrismaClient } from "@prisma/client";

// Run this script via `tsx --env-file=.env` so process.env is populated
// before Prisma or the RAZORPAY_ACCOUNT_ID check runs — that's what the
// `link-demo-merchant` npm script does. Prisma itself will pick up
// DATABASE_URL from .env either way, but the raw `RAZORPAY_ACCOUNT_ID`
// read below won't, hence the flag.

const prisma = new PrismaClient();

async function main() {
  const accountId = (process.env.RAZORPAY_ACCOUNT_ID ?? "").trim();
  if (!accountId) {
    console.log(
      "RAZORPAY_ACCOUNT_ID is not set in .env — nothing to link. " +
        "Set it (acc_...) and re-run this script.",
    );
    return;
  }

  const merchant = await prisma.merchant.findFirst({
    where: { name: "QuickCart India" },
  });
  if (!merchant) {
    console.error(
      "No merchant named 'QuickCart India' found — has the seed been run?",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nBefore:  ${merchant.name}  →  ${merchant.razorpayAccountId}`);

  if (merchant.razorpayAccountId === accountId) {
    console.log("Already linked to this account id — no change.\n");
    return;
  }

  const updated = await prisma.merchant.update({
    where: { id: merchant.id },
    data: { razorpayAccountId: accountId },
  });

  console.log(`After:   ${updated.name}  →  ${updated.razorpayAccountId}\n`);
}

main()
  .catch((e) => {
    console.error("link-demo-merchant failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
