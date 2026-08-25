/**
 * Message generation contracts.
 *
 * Everything downstream (the orchestrator, tests, the future dashboard)
 * depends on the `MessageGenerator` interface — never on a concrete
 * implementation. The factory in `index.ts` is the single place that
 * decides which implementation is live.
 */

export interface MessageGenerationInput {
  caseId: string;
  causeCode: string;
  scenario: "CHECKOUT_DROPOFF" | "SUBSCRIPTION_FAILURE" | "INVOICE_OVERDUE";
  channel: "EMAIL" | "SMS" | "WHATSAPP";
  language: "EN" | "HINGLISH";
  customerName: string;
  merchantName: string;
  amountPaise: number;
  currency: string;
  /** Razorpay Payment Link short_url from Phase 4. Never a placeholder string. */
  recoveryLink: string;
  /** 1st attempt vs 2nd — tone can differ (retries acknowledge prior contact). */
  attemptNumber: number;
  /**
   * The orchestrator's chosen action for this send (e.g. "RETRY_LINK",
   * "RE_AUTH_LINK", "FRIENDLY_NUDGE", "FIRM_REMINDER") — Phase 9. Mainly
   * used to disambiguate INVOICE_OVERDUE's graduated-escalation copy,
   * since the causeCode alone is the same at every tier.
   */
  action?: string;
  /** INVOICE_OVERDUE only — real invoice number, never a placeholder. */
  invoiceNumber?: string;
  /** INVOICE_OVERDUE only — days past the due date, floored at 0. */
  daysOverdue?: number;
  /** INVOICE_OVERDUE only — the due date, pre-formatted for display. */
  dueDateLabel?: string;
}

export interface MessageGenerationResult {
  subject?: string;
  body: string;
  generatedBy: "TEMPLATE" | "LLM";
  promptVersion?: string;
}

export interface MessageGenerator {
  generate(
    input: MessageGenerationInput,
  ): Promise<MessageGenerationResult>;
}
