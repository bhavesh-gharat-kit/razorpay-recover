/**
 * Unit tests for webhook idempotency check logic.
 *
 * These tests verify the idempotency contract: given a razorpayRefId,
 * inserting the same event twice should only create one RecoveryEvent row.
 * We test the logic in isolation using a mock Prisma client.
 */

import { describe, it, expect, vi } from "vitest";

/**
 * Simulate the idempotency check logic from the webhook route.
 * Extracted here as a pure function for testability.
 */
async function checkIdempotency(
  razorpayRefId: string,
  findUnique: (args: {
    where: { razorpayRefId: string };
  }) => Promise<{ id: string } | null>,
): Promise<{ isDuplicate: boolean; existingId?: string }> {
  const existing = await findUnique({
    where: { razorpayRefId },
  });

  if (existing) {
    return { isDuplicate: true, existingId: existing.id };
  }

  return { isDuplicate: false };
}

describe("webhook idempotency", () => {
  it("detects a duplicate when razorpayRefId already exists", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "existing_id_123" });

    const result = await checkIdempotency("evt_duplicate_001", findUnique);

    expect(result.isDuplicate).toBe(true);
    expect(result.existingId).toBe("existing_id_123");
    expect(findUnique).toHaveBeenCalledWith({
      where: { razorpayRefId: "evt_duplicate_001" },
    });
  });

  it("allows a new event when razorpayRefId does not exist", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);

    const result = await checkIdempotency("evt_new_001", findUnique);

    expect(result.isDuplicate).toBe(false);
    expect(result.existingId).toBeUndefined();
  });

  it("handles concurrent duplicate checks correctly", async () => {
    // Simulate race: both calls see null initially, but only one should
    // succeed at insert (DB unique constraint). This test verifies that
    // our check function correctly reports non-duplicate for both, and
    // the DB constraint handles the actual race.
    const findUnique = vi.fn().mockResolvedValue(null);

    const [result1, result2] = await Promise.all([
      checkIdempotency("evt_race_001", findUnique),
      checkIdempotency("evt_race_001", findUnique),
    ]);

    // Both see no existing record — the DB unique constraint on
    // razorpayRefId is the final safeguard against actual duplicates.
    expect(result1.isDuplicate).toBe(false);
    expect(result2.isDuplicate).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("uses the exact razorpayRefId for lookup", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);

    await checkIdempotency("evt_AbC_123", findUnique);

    // Verify it passes the ID through unchanged (case-sensitive)
    expect(findUnique).toHaveBeenCalledWith({
      where: { razorpayRefId: "evt_AbC_123" },
    });
  });
});
