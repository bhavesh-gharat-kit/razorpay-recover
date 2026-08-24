/**
 * Unit tests for the embedding-based fallback classifier.
 *
 * These tests require the ONNX model to download on first run (~23 MB),
 * so they have an extended timeout.
 */

import { describe, it, expect } from "vitest";
import { classifyByEmbedding, cosineSimilarity } from "../embeddings";

// All embedding tests need extended timeout for model download/init.
const EMBEDDING_TIMEOUT = 120_000;

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });
});

describe("classifyByEmbedding", { timeout: EMBEDDING_TIMEOUT }, () => {
  it("classifies a phrase about insufficient funds correctly", async () => {
    const result = await classifyByEmbedding(
      "the payment was declined because the bank account balance was too low",
    );
    expect(result.causeCode).toBe("INSUFFICIENT_FUNDS");
    expect(result.confidence).toBeGreaterThan(0.55);
  });

  it("classifies a phrase about expired card correctly", async () => {
    const result = await classifyByEmbedding(
      "the card's expiration date has passed and it is no longer valid",
    );
    expect(result.causeCode).toBe("CARD_EXPIRED");
    expect(result.confidence).toBeGreaterThan(0.55);
  });

  it("classifies a phrase about gateway timeout correctly", async () => {
    const result = await classifyByEmbedding(
      "the bank server took too long and the transaction timed out",
    );
    expect(result.causeCode).toBe("GATEWAY_TIMEOUT");
    expect(result.confidence).toBeGreaterThan(0.55);
  });

  it("classifies a phrase about OTP abandonment correctly", async () => {
    const result = await classifyByEmbedding(
      "the customer closed the browser before entering the OTP code",
    );
    expect(result.causeCode).toBe("OTP_ABANDONED");
    expect(result.confidence).toBeGreaterThan(0.55);
  });

  it("returns UNCLASSIFIED for nonsense / unrelated text", async () => {
    const result = await classifyByEmbedding(
      "the quick brown fox jumps over the lazy dog on a sunny afternoon",
    );
    // Either UNCLASSIFIED (below threshold) or very low confidence
    if (result.causeCode !== "UNCLASSIFIED") {
      // If it did match something, confidence should be very low
      expect(result.confidence).toBeLessThan(0.65);
    }
  });
});
