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
  // Subscription Failure (Phase 9)
  "MANDATE_INSUFFICIENT_FUNDS",
  "MANDATE_LAPSED",
  "MANDATE_EXPIRED_CARD",
  // B2B Invoice Overdue (Phase 9)
  "INVOICE_OVERDUE",
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
  /**
   * Match against the webhook's top-level `event` field (exact), e.g.
   * "subscription.charged.failed". Scopes a rule to a specific event type
   * so subscription mandate wording never gets read off a plain checkout
   * `payment.failed` event, and vice versa. Undefined matches any event.
   */
  event?: string;
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
  // INSUFFICIENT_FUNDS — declined-by-bank descriptions. Scoped to
  // `event: "payment.failed"` so a subscription.charged.failed event
  // with overlapping wording (e.g. "insufficient") falls through to the
  // dedicated MANDATE_INSUFFICIENT_FUNDS rules below instead of being
  // misread as a checkout cause.
  {
    event: "payment.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["insufficient"],
    result: { causeCode: "INSUFFICIENT_FUNDS", confidence: 0.97 },
  },
  {
    event: "payment.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["declined by the bank"],
    result: { causeCode: "INSUFFICIENT_FUNDS", confidence: 0.95 },
  },
  {
    event: "payment.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["low funds"],
    result: { causeCode: "INSUFFICIENT_FUNDS", confidence: 0.96 },
  },
  {
    event: "payment.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["not enough balance"],
    result: { causeCode: "INSUFFICIENT_FUNDS", confidence: 0.96 },
  },

  // CARD_EXPIRED — expired / invalid card
  {
    event: "payment.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["expired"],
    result: { causeCode: "CARD_EXPIRED", confidence: 0.97 },
  },
  {
    event: "payment.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["invalid card"],
    result: { causeCode: "CARD_EXPIRED", confidence: 0.95 },
  },

  // GATEWAY_TIMEOUT — gateway or server errors (transient infra failures)
  {
    event: "payment.failed",
    errorCode: "GATEWAY_ERROR",
    result: { causeCode: "GATEWAY_TIMEOUT", confidence: 0.96 },
  },
  {
    event: "payment.failed",
    errorCode: "SERVER_ERROR",
    result: { causeCode: "GATEWAY_TIMEOUT", confidence: 0.95 },
  },

  // OTP_ABANDONED — user cancelled / abandoned at OTP / auth step
  {
    event: "payment.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["otp"],
    result: { causeCode: "OTP_ABANDONED", confidence: 0.96 },
  },
  {
    event: "payment.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["cancelled by the user"],
    result: { causeCode: "OTP_ABANDONED", confidence: 0.95 },
  },
  // UPI with no payment_id — user never completed the UPI flow
  {
    event: "payment.failed",
    method: "upi",
    noPaymentId: true,
    result: { causeCode: "OTP_ABANDONED", confidence: 0.90 },
  },

  // ---------------------------------------------------------------------
  // Subscription Failure (Phase 9) — `subscription.charged.failed` carries
  // the same `payload.payment.entity` error shape as `payment.failed`, so
  // it reuses the same errorCode/descriptionContains matching. Every rule
  // here is scoped with `event` so a checkout drop-off never gets read as
  // a mandate problem just because the wording happens to overlap.
  // `subscription.halted` (no payment entity at all — Razorpay only halts
  // a subscription after repeated mandate charge failures) is handled as
  // a special case in classifyByRules() below, ahead of the entity lookup.
  // ---------------------------------------------------------------------

  // MANDATE_INSUFFICIENT_FUNDS — recurring charge failed, low balance.
  {
    event: "subscription.charged.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["insufficient"],
    result: { causeCode: "MANDATE_INSUFFICIENT_FUNDS", confidence: 0.97 },
  },
  {
    event: "subscription.charged.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["low balance"],
    result: { causeCode: "MANDATE_INSUFFICIENT_FUNDS", confidence: 0.96 },
  },

  // MANDATE_EXPIRED_CARD — the card backing the mandate has expired.
  {
    event: "subscription.charged.failed",
    errorCode: "BAD_REQUEST_ERROR",
    descriptionContains: ["card", "expired"],
    result: { causeCode: "MANDATE_EXPIRED_CARD", confidence: 0.96 },
  },

  // MANDATE_LAPSED — the mandate itself expired or was revoked by the
  // bank. Critical distinction: this needs re-authorization, NOT a blind
  // retry — retrying a lapsed mandate just fails again the same way.
  {
    event: "subscription.charged.failed",
    descriptionContains: ["mandate"],
    result: { causeCode: "MANDATE_LAPSED", confidence: 0.95 },
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

/** Extract the webhook's top-level `event` field, e.g. "payment.failed". */
export function extractEventType(rawPayload: unknown): string {
  try {
    return String((rawPayload as Record<string, unknown>)?.event ?? "");
  } catch {
    return "";
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
  const event = extractEventType(rawPayload);

  // subscription.halted carries no payment entity to inspect — Razorpay
  // only halts a subscription after mandate charge retries are exhausted,
  // so the event type alone is a reliable, high-confidence signal.
  if (event === "subscription.halted") {
    return { causeCode: "MANDATE_LAPSED", confidence: 0.97 };
  }

  const signals = extractSignals(rawPayload);
  if (!signals) return null;

  for (const rule of RULES) {
    if (!matchesRule(rule, signals, event)) continue;
    return { ...rule.result };
  }

  return null;
}

/**
 * Extract the human-readable invoice number from a synthetic/real
 * `invoice.expired`-shaped rawPayload (`payload.invoice.entity.invoice_number`),
 * for use as a message fact — never a hallucinated one. Returns null when
 * absent so the caller can fall back to a deterministic case-derived label.
 */
export function extractInvoiceNumber(rawPayload: unknown): string | null {
  try {
    const payload = rawPayload as Record<string, unknown>;
    const inner = payload?.payload as Record<string, unknown> | undefined;
    const invoice = inner?.invoice as Record<string, unknown> | undefined;
    const entity = invoice?.entity as Record<string, unknown> | undefined;
    const invoiceNumber = entity?.invoice_number;
    return typeof invoiceNumber === "string" && invoiceNumber.length > 0
      ? invoiceNumber
      : null;
  } catch {
    return null;
  }
}

/**
 * Classify a B2B invoice as overdue — the rules-only path for
 * INVOICE_OVERDUE (Phase 9). The "cause" is just time passing the due
 * date, so there's no ambiguous free text to fall back to embeddings for.
 */
export function classifyInvoiceOverdue(
  dueDate: Date | null,
  now: Date = new Date(),
): RuleMatch {
  if (dueDate && dueDate.getTime() < now.getTime()) {
    return { causeCode: "INVOICE_OVERDUE", confidence: 1.0 };
  }
  return { causeCode: "UNCLASSIFIED", confidence: 0 };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function matchesRule(
  rule: ClassificationRule,
  signals: PaymentSignals,
  event: string,
): boolean {
  // event match (exact)
  if (rule.event !== undefined && event !== rule.event) {
    return false;
  }

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
