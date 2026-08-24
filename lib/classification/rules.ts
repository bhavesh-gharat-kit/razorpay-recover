/**
 * Deterministic rule-based classifier for Razorpay payment failure events.
 *
 * Maps known Razorpay `error_code` + `error_description` patterns to fixed
 * cause codes. Returns null when no rule matches — the caller should fall
 * through to the embedding classifier.
 *
 * The rule table intentionally handles only clear-cut signals. Ambiguous
 * free-text descriptions are left for the embedding fallback so we never
 * over-claim certainty.
 */

// ---------------------------------------------------------------------------
// Cause codes (shared vocabulary across the classification engine)
// ---------------------------------------------------------------------------

export const CAUSE_CODES = [
  "INSUFFICIENT_FUNDS",
  "CARD_EXPIRED",
  "GATEWAY_TIMEOUT",
  "OTP_ABANDONED",
  "UNCLASSIFIED",
] as const;

export type CauseCode = (typeof CAUSE_CODES)[number];

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------

interface RuleMatch {
  causeCode: CauseCode;
  confidence: number;
}

/**
 * A single rule. Fields are checked against the flattened payment entity
 * from `rawPayload.payload.payment.entity`. Every non-undefined field must
 * match for the rule to fire.
 */
interface ClassificationRule {
  /** Match against `error_code` (exact, case-insensitive). */
  errorCode?: string;
  /** Substring match against `error_description` (case-insensitive). */
  descriptionContains?: string[];
  /** Match against `method` (exact, case-insensitive). */
  method?: string;
  /** True if the payment entity has no `id` / null id. */
  noPaymentId?: boolean;
  /** Result when this rule fires. */
  result: RuleMatch;
}

const RULES: ClassificationRule[] = [
  // INSUFFICIENT_FUNDS — declined-by-bank descriptions
  {
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["insufficient"],
    result: { causeCode: "INSUFFICIENT_FUNDS", confidence: 0.97 },
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["declined by the bank"],
    result: { causeCode: "INSUFFICIENT_FUNDS", confidence: 0.95 },
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["low funds"],
    result: { causeCode: "INSUFFICIENT_FUNDS", confidence: 0.96 },
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["not enough balance"],
    result: { causeCode: "INSUFFICIENT_FUNDS", confidence: 0.96 },
  },

  // CARD_EXPIRED — expired / invalid card
  {
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["expired"],
    result: { causeCode: "CARD_EXPIRED", confidence: 0.97 },
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["invalid card"],
    result: { causeCode: "CARD_EXPIRED", confidence: 0.95 },
  },

  // GATEWAY_TIMEOUT — gateway or server errors (transient infra failures)
  {
    errorCode: "GATEWAY_ERROR",
    result: { causeCode: "GATEWAY_TIMEOUT", confidence: 0.96 },
  },
  {
    errorCode: "SERVER_ERROR",
    result: { causeCode: "GATEWAY_TIMEOUT", confidence: 0.95 },
  },

  // OTP_ABANDONED — user cancelled / abandoned at OTP / auth step
  {
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["otp"],
    result: { causeCode: "OTP_ABANDONED", confidence: 0.96 },
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["cancelled by the user"],
    result: { causeCode: "OTP_ABANDONED", confidence: 0.95 },
  },
  // UPI with no payment_id — user never completed the UPI flow
  {
    method: "upi",
    noPaymentId: true,
    result: { causeCode: "OTP_ABANDONED", confidence: 0.90 },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the payment entity from a Razorpay `payment.failed` webhook
 * rawPayload. Returns a flat object with the fields the rules check.
 */
interface PaymentSignals {
  errorCode: string;
  errorDescription: string;
  method: string;
  paymentId: string | null;
}

export function extractSignals(rawPayload: unknown): PaymentSignals | null {
  try {
    const payload = rawPayload as Record<string, unknown>;
    const inner = payload?.payload as Record<string, unknown> | undefined;
    const payment = inner?.payment as Record<string, unknown> | undefined;
    const entity = payment?.entity as Record<string, unknown> | undefined;

    if (!entity) return null;

    return {
      errorCode: String(entity.error_code ?? ""),
      errorDescription: String(entity.error_description ?? ""),
      method: String(entity.method ?? ""),
      paymentId: entity.id ? String(entity.id) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Classify a recovery event using deterministic rules only.
 *
 * @returns A `{ causeCode, confidence }` if a rule matched, or `null` if
 *          no rule covers this event (caller should try embeddings next).
 */
export function classifyByRules(
  rawPayload: unknown,
): RuleMatch | null {
  const signals = extractSignals(rawPayload);
  if (!signals) return null;

  for (const rule of RULES) {
    if (!matchesRule(rule, signals)) continue;
    return { ...rule.result };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function matchesRule(rule: ClassificationRule, signals: PaymentSignals): boolean {
  // error_code match (case-insensitive)
  if (
    rule.errorCode !== undefined &&
    signals.errorCode.toUpperCase() !== rule.errorCode.toUpperCase()
  ) {
    return false;
  }

  // description substring matches (all must hit)
  if (rule.descriptionContains !== undefined) {
    const desc = signals.errorDescription.toLowerCase();
    for (const needle of rule.descriptionContains) {
      if (!desc.includes(needle.toLowerCase())) return false;
    }
  }

  // method match
  if (
    rule.method !== undefined &&
    signals.method.toLowerCase() !== rule.method.toLowerCase()
  ) {
    return false;
  }

  // noPaymentId match
  if (rule.noPaymentId !== undefined) {
    const hasNoId = !signals.paymentId;
    if (hasNoId !== rule.noPaymentId) return false;
  }

  return true;
}
