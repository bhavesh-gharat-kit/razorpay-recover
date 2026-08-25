/** One-shot: pick a case not yet processed, plant a fresh
 *  classification_below_threshold transition on top so it appears in the
 *  approval queue's below_threshold bucket. */
import { PrismaClient, Actor, ClassificationSource } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  // Pick any case that's still DETECTED (there shouldn't be any now, so
  // pick a small-amount DIAGNOSED case that hasn't been actioned yet).
  const target = await p.case.findFirst({
    where: {
      state: "DETECTED",
    },
    include: { recoveryEvent: true },
  });
  if (!target) {
    console.log("no DETECTED case — creating a low-confidence classification on a DIAGNOSED one");
    const diag = await p.case.findFirst({
      where: { state: "DIAGNOSED" },
      include: { transitions: { take: 1, orderBy: { createdAt: "desc" } } },
    });
    if (!diag) { console.log("no cases available"); return; }
    await p.caseTransition.create({
      data: {
        caseId: diag.id,
        fromState: "DIAGNOSED",
        toState: "DIAGNOSED",
        actor: Actor.SYSTEM,
        reasonCode: "classification_below_threshold",
        metadata: { source: ClassificationSource.EMBEDDING, confidence: 0.31, threshold: 0.55 },
      },
    });
    console.log(diag.id);
    return;
  }
  await p.caseTransition.create({
    data: {
      caseId: target.id,
      fromState: "DETECTED",
      toState: "DETECTED",
      actor: Actor.SYSTEM,
      reasonCode: "classification_below_threshold",
      metadata: { source: ClassificationSource.EMBEDDING, confidence: 0.31, threshold: 0.55 },
    },
  });
  console.log(target.id);
}
main().finally(() => p.$disconnect());
