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
