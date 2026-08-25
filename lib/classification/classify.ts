/**
 * Classification orchestrator.
 *
 * Takes a RecoveryEvent, runs it through the deterministic rule table
 * first, falls back to embedding similarity for ambiguous cases, persists
 * the ClassifiedCase row, transitions the Case, and writes audit entries.
 *
 * This module NEVER calls an external API — all classification is local.
 */

import { prisma } from "@/lib/db";
import { Actor, CaseState, ClassificationSource, Scenario } from "@prisma/client";
import { classifyByRules, classifyInvoiceOverdue, extractSignals } from "./rules";
import { classifyByEmbedding, CONFIDENCE_THRESHOLD } from "./embeddings";
import type { CauseCode } from "./rules";
import { emitCaseTransition } from "@/lib/events/emit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  classifiedCaseId: string;
  causeCode: CauseCode;
  confidence: number;
  source: ClassificationSource;
  transitioned: boolean; // true if the case moved to DIAGNOSED
}

// ---------------------------------------------------------------------------
// Main orchestration function
// ---------------------------------------------------------------------------

/**
 * Classify a single recovery event:
 * 1. Load the RecoveryEvent and its associated Case.
 * 2. Try deterministic rules first (high confidence).
 * 3. Fall back to embedding similarity on the error description.
 * 4. Persist ClassifiedCase, link it to the Case, optionally transition
 *    the Case to DIAGNOSED.
 * 5. Write CaseTransition + AuditLog entries for traceability.
 */
export async function classifyRecoveryEvent(
  eventId: string,
): Promise<ClassificationResult> {
  // 1. Load event + case
  const event = await prisma.recoveryEvent.findUniqueOrThrow({
    where: { id: eventId },
    include: { case: true },
  });

  const caseRecord = event.case;
  if (!caseRecord) {
    throw new Error(`RecoveryEvent ${eventId} has no associated Case`);
  }

  // 2. Try rules first
  let causeCode: CauseCode;
  let confidence: number;
  let source: ClassificationSource;

  if (event.scenario === Scenario.INVOICE_OVERDUE) {
    // Rules-only path (Phase 9) — the cause is just "is dueDate in the
    // past?", so there's no free text to fall back to embeddings for.
    const invoiceResult = classifyInvoiceOverdue(event.dueDate);
    causeCode = invoiceResult.causeCode;
    confidence = invoiceResult.confidence;
    source = ClassificationSource.RULE;
  } else {
    const ruleResult = classifyByRules(event.rawPayload);

    if (ruleResult) {
      causeCode = ruleResult.causeCode;
      confidence = ruleResult.confidence;
      source = ClassificationSource.RULE;
    } else {
      // 3. Fall back to embedding similarity
      const signals = extractSignals(event.rawPayload);
      const freeText = signals?.errorDescription ?? "";

      const embeddingResult = await classifyByEmbedding(freeText);
      causeCode = embeddingResult.causeCode as CauseCode;
      confidence = embeddingResult.confidence;
      source = ClassificationSource.EMBEDDING;
    }
  }

  // 4. Determine whether this is a confident classification
  const isConfident =
    causeCode !== "UNCLASSIFIED" && confidence >= CONFIDENCE_THRESHOLD;

  // 5. Persist everything in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create ClassifiedCase
    const classifiedCase = await tx.classifiedCase.create({
      data: {
        recoveryEventId: eventId,
        causeCode,
        confidence,
        source,
        modelVersion:
          source === ClassificationSource.EMBEDDING
            ? "Xenova/all-MiniLM-L6-v2"
            : null,
      },
    });

    // Link ClassifiedCase to Case
    await tx.case.update({
      where: { id: caseRecord.id },
      data: { classifiedCaseId: classifiedCase.id },
    });

    // Transition + Audit
    if (isConfident) {
      // Transition to DIAGNOSED
      await tx.case.update({
        where: { id: caseRecord.id },
        data: { state: CaseState.DIAGNOSED },
      });

      await tx.caseTransition.create({
        data: {
          caseId: caseRecord.id,
          fromState: caseRecord.state,
          toState: CaseState.DIAGNOSED,
          actor: Actor.SYSTEM,
          reasonCode: `classified_${causeCode}`,
          metadata: {
            classifiedCaseId: classifiedCase.id,
            source,
            confidence,
          },
        },
      });

      await emitCaseTransition(tx, {
        caseId: caseRecord.id,
        fromState: caseRecord.state,
        toState: CaseState.DIAGNOSED,
        causeCode,
      });
    } else {
      // Below threshold — stay at DETECTED, record explicitly
      await tx.caseTransition.create({
        data: {
          caseId: caseRecord.id,
          fromState: caseRecord.state,
          toState: caseRecord.state, // no state change
          actor: Actor.SYSTEM,
          reasonCode: "classification_below_threshold",
          metadata: {
            classifiedCaseId: classifiedCase.id,
            source,
            causeCode,
            confidence,
            threshold: CONFIDENCE_THRESHOLD,
          },
        },
      });
    }

    // AuditLog — every classification decision, successful or not
    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseRecord.id,
        actor: Actor.SYSTEM,
        action: isConfident
          ? "classification_succeeded"
          : "classification_below_threshold",
        reasonCode: `classified_${causeCode}`,
        afterState: {
          classifiedCaseId: classifiedCase.id,
          causeCode,
          confidence,
          source,
          transitioned: isConfident,
        },
      },
    });

    return {
      classifiedCaseId: classifiedCase.id,
      causeCode,
      confidence,
      source,
      transitioned: isConfident,
    } as ClassificationResult;
  });

  return result;
}
