/**
 * Embedding-based fallback classifier for ambiguous payment failures.
 *
 * Uses `@huggingface/transformers` to load `Xenova/all-MiniLM-L6-v2`
 * entirely in-process — no external API call, no GPU required. The model
 * downloads once (~23 MB) and is cached locally by the HuggingFace SDK.
 *
 * The pipeline and exemplar embeddings are loaded lazily (on first call)
 * and cached as module-level singletons so they survive across requests.
 */

import type { CauseCode } from "./rules";

// ---------------------------------------------------------------------------
// Exemplar set — labeled phrases per cause code
// ---------------------------------------------------------------------------

/** Each cause code maps to 5-8 example phrases in English and Hinglish. */
export const EXEMPLARS: Record<Exclude<CauseCode, "UNCLASSIFIED">, string[]> = {
  INSUFFICIENT_FUNDS: [
    "the customer's account did not have enough balance",
    "payment declined due to low funds",
    "customer ke account mein paisa nahi tha",
    "your bank account has insufficient balance for this transaction",
    "bank ne payment reject kar diya kyunki balance kam tha",
    "not enough money in the account to complete this payment",
    "transaction failed because of insufficient funds in the linked account",
    "paise kam the isliye payment fail ho gaya",
  ],
  CARD_EXPIRED: [
    "the card used for payment has expired",
    "payment failed because the card is no longer valid",
    "card ki validity khatam ho gayi hai",
    "your card has passed its expiry date",
    "expired card se payment try kiya lekin fail ho gaya",
    "the credit card is expired and needs to be renewed",
    "card expire ho chuka hai naya card use karo",
    "invalid card number or expired card details provided",
  ],
  GATEWAY_TIMEOUT: [
    "payment processing timed out at the bank gateway",
    "the payment gateway did not respond in time",
    "server error while processing your payment",
    "bank ka system abhi slow chal raha hai",
    "gateway ne time mein response nahi diya",
    "an unexpected error occurred during payment processing",
    "payment processing didn't complete due to a technical issue",
    "technical issue at the payment processor end",
  ],
  OTP_ABANDONED: [
    "customer cancelled the payment at the OTP step",
    "user did not complete OTP verification",
    "customer ne OTP dalne se pehle cancel kar diya",
    "payment was abandoned before authentication completed",
    "user ne UPI pin enter nahi kiya",
    "customer left the payment page without completing verification",
    "OTP page pe jaake customer ne back button press kar diya",
    "user abandoned checkout before completing two-factor authentication",
  ],
};

// ---------------------------------------------------------------------------
// Confidence threshold
// ---------------------------------------------------------------------------

/**
 * Minimum cosine similarity required to accept an embedding-based
 * classification. Below this, the event is marked UNCLASSIFIED and routed
 * to human review.
 *
 * 0.55 is a reasonable starting point for MiniLM cosine similarity on
 * short phrases. This SHOULD be tuned once real production data is
 * observed — run the test-classification script after adjusting to check
 * accuracy impact.
 */
export const CONFIDENCE_THRESHOLD = 0.55;

// ---------------------------------------------------------------------------
// Pipeline singleton
// ---------------------------------------------------------------------------

// We lazy-import `@huggingface/transformers` to avoid loading the ONNX
// runtime at module parse time (it's heavy and not needed until the first
// embedding call).

type Pipeline = {
  (text: string, options?: Record<string, unknown>): Promise<{ data: Float32Array }>;
};

let pipelineInstance: Pipeline | null = null;
let exemplarEmbeddings: { causeCode: Exclude<CauseCode, "UNCLASSIFIED">; embedding: Float32Array }[] | null = null;

/**
 * Lazily initialize the feature-extraction pipeline and precompute
 * exemplar embeddings. Subsequent calls return the cached instances.
 */
async function getOrInitPipeline(): Promise<{
  pipe: Pipeline;
  exemplars: { causeCode: Exclude<CauseCode, "UNCLASSIFIED">; embedding: Float32Array }[];
}> {
  if (pipelineInstance && exemplarEmbeddings) {
    return { pipe: pipelineInstance, exemplars: exemplarEmbeddings };
  }

  // Dynamic import so the ONNX runtime is only loaded when needed.
  const { pipeline } = await import("@huggingface/transformers");

  // The @huggingface/transformers package uses the model id format
  // "Xenova/all-MiniLM-L6-v2" (community ONNX conversion).
  const pipe = (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    // Use default (CPU) device — no GPU required.
    dtype: "fp32",
  })) as unknown as Pipeline;

  pipelineInstance = pipe;

  // Precompute exemplar embeddings
  const entries: { causeCode: Exclude<CauseCode, "UNCLASSIFIED">; embedding: Float32Array }[] = [];

  for (const [code, phrases] of Object.entries(EXEMPLARS) as [
    Exclude<CauseCode, "UNCLASSIFIED">,
    string[],
  ][]) {
    for (const phrase of phrases) {
      const result = await pipe(phrase, { pooling: "mean", normalize: true });
      entries.push({ causeCode: code, embedding: new Float32Array(result.data) });
    }
  }

  exemplarEmbeddings = entries;

  return { pipe, exemplars: exemplarEmbeddings };
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EmbeddingClassificationResult {
  causeCode: CauseCode;
  confidence: number;
}

/**
 * Classify a free-text description using embedding similarity against
 * the labeled exemplar set. Returns the best-matching cause code with
 * the cosine similarity as the confidence score.
 *
 * If the best match is below `CONFIDENCE_THRESHOLD`, returns
 * `causeCode: "UNCLASSIFIED"` instead of forcing a guess.
 */
export async function classifyByEmbedding(
  freeText: string,
): Promise<EmbeddingClassificationResult> {
  const { pipe, exemplars } = await getOrInitPipeline();

  const inputResult = await pipe(freeText, { pooling: "mean", normalize: true });
  const inputEmbedding = new Float32Array(inputResult.data);

  let bestCode: CauseCode = "UNCLASSIFIED";
  let bestSimilarity = -Infinity;

  for (const exemplar of exemplars) {
    const sim = cosineSimilarity(inputEmbedding, exemplar.embedding);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestCode = exemplar.causeCode;
    }
  }

  // Apply threshold — below this we don't trust the match.
  if (bestSimilarity < CONFIDENCE_THRESHOLD) {
    return { causeCode: "UNCLASSIFIED", confidence: bestSimilarity };
  }

  return { causeCode: bestCode, confidence: bestSimilarity };
}

/**
 * Force-initialize the pipeline and precompute exemplar embeddings.
 * Useful for warming up at application start so the first classification
 * call doesn't pay the full load cost.
 */
export async function warmupEmbeddings(): Promise<void> {
  await getOrInitPipeline();
}
