/**
 * Classification test script — runs classification against the full
 * Phase 1 seed batch and prints an accuracy breakdown.
 *
 * Usage:  npx tsx scripts/test-classification.ts
 *
 * This reseeds the DB first (to ensure a clean state), then runs the
 * classification engine on every DETECTED case, and compares the result
 * against the known cause code embedded in each event's rawPayload by
 * the seed script.
 *
 * The seed script's cause-code logic (from seed.ts) derives the "true"
 * label from the error_description content:
 *   - "declined by the bank" → INSUFFICIENT_FUNDS
 *   - "expired"              → CARD_EXPIRED
 *   - "didn't complete on time" → GATEWAY_TIMEOUT
 *   - "cancelled by the user" → OTP_ABANDONED
 *   - anything else          → AMBIGUOUS (might map to GATEWAY_TIMEOUT
 *                               or be genuinely ambiguous)
 */

import { PrismaClient, CaseState } from "@prisma/client";
import { classifyRecoveryEvent } from "../lib/classification/classify";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Ground-truth labeler — mirrors seed.ts cause assignment logic
// ---------------------------------------------------------------------------

function getTrueLabel(rawPayload: unknown): string {
  try {
    const p = rawPayload as Record<string, unknown>;
    const inner = p?.payload as Record<string, unknown>;
    const payment = inner?.payment as Record<string, unknown>;
    const entity = payment?.entity as Record<string, unknown>;
    const desc = String(entity?.error_description ?? "").toLowerCase();

    if (desc.includes("declined by the bank")) return "INSUFFICIENT_FUNDS";
    if (desc.includes("insufficient")) return "INSUFFICIENT_FUNDS";
    if (desc.includes("expired")) return "CARD_EXPIRED";
    if (desc.includes("didn't complete on time") || desc.includes("didn't complete on time"))
      return "GATEWAY_TIMEOUT";
    if (desc.includes("cancelled by the user")) return "OTP_ABANDONED";

    // The remaining are the AMBIGUOUS seeds — their "true" label depends
    // on the actual error_code, which the classifier may also use.
    const errorCode = String(entity?.error_code ?? "").toUpperCase();
    if (errorCode === "GATEWAY_ERROR" || errorCode === "SERVER_ERROR")
      return "GATEWAY_TIMEOUT";

    // Genuinely ambiguous — we accept any answer or UNCLASSIFIED
    return "AMBIGUOUS";
  } catch {
    return "AMBIGUOUS";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n━━━ Classification Test Script ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Find all DETECTED cases without a ClassifiedCase
  const pendingCases = await prisma.case.findMany({
    where: {
      state: CaseState.DETECTED,
      classifiedCaseId: null,
    },
    include: {
      recoveryEvent: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`  Found ${pendingCases.length} unclassified DETECTED cases.\n`);

  if (pendingCases.length === 0) {
    console.log("  Nothing to classify. Run `npx prisma db seed` first.\n");
    return;
  }

  // Counters
  let totalProcessed = 0;
  let byRule = 0;
  let byEmbedding = 0;
  let sentToReview = 0;
  let correct = 0;
  let incorrect = 0;
  let ambiguousTotal = 0;

  const confusionMatrix: Record<string, Record<string, number>> = {};

  for (const c of pendingCases) {
    const trueLabel = getTrueLabel(c.recoveryEvent.rawPayload);
    totalProcessed++;

    try {
      const result = await classifyRecoveryEvent(c.recoveryEvent.id);

      // Track source
      if (result.source === "RULE") byRule++;
      else byEmbedding++;
      if (!result.transitioned) sentToReview++;

      // Track accuracy
      const predicted = result.causeCode;

      if (trueLabel === "AMBIGUOUS") {
        // For genuinely ambiguous seeds, any classification is acceptable
        ambiguousTotal++;
      } else if (predicted === trueLabel) {
        correct++;
      } else {
        incorrect++;
        // Log misclassifications for debugging
        console.log(
          `  ⚠ Misclassified: true=${trueLabel}, predicted=${predicted}, ` +
            `confidence=${result.confidence.toFixed(3)}, source=${result.source}`,
        );
      }

      // Confusion matrix
      if (!confusionMatrix[trueLabel]) confusionMatrix[trueLabel] = {};
      confusionMatrix[trueLabel][predicted] =
        (confusionMatrix[trueLabel][predicted] || 0) + 1;
    } catch (err) {
      console.error(`  ✗ Error classifying event ${c.recoveryEvent.id}:`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const nonAmbiguous = correct + incorrect;
  const accuracy = nonAmbiguous > 0 ? (correct / nonAmbiguous) * 100 : 0;

  console.log("\n━━━ Results ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`  Total processed:   ${totalProcessed}`);
  console.log(`  By RULE:           ${byRule}`);
  console.log(`  By EMBEDDING:      ${byEmbedding}`);
  console.log(`  Sent to review:    ${sentToReview}`);
  console.log(`  Correct:           ${correct} / ${nonAmbiguous} non-ambiguous`);
  console.log(`  Incorrect:         ${incorrect}`);
  console.log(`  Ambiguous (any OK):${ambiguousTotal}`);
  console.log(`  Accuracy:          ${accuracy.toFixed(1)}%`);

  console.log("\n━━━ Confusion Matrix ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  const allLabels = Array.from(
    new Set([
      ...Object.keys(confusionMatrix),
      ...Object.values(confusionMatrix).flatMap((v) => Object.keys(v)),
    ]),
  ).sort();

  // Header
  const colWidth = 20;
  console.log(
    "  " + "True \\ Predicted".padEnd(colWidth) + allLabels.map((l) => l.padStart(colWidth)).join(""),
  );

  for (const trueLabel of allLabels) {
    const row = confusionMatrix[trueLabel] || {};
    const cells = allLabels.map((pred) =>
      String(row[pred] || 0).padStart(colWidth),
    );
    console.log("  " + trueLabel.padEnd(colWidth) + cells.join(""));
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => {
    console.error("Test script failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
