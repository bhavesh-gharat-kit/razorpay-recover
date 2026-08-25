import { describe, it, expect } from "vitest";
import { renderTemplateMessage } from "../templateGenerator";
import { formatAmountINR } from "../formatAmount";
import type { MessageGenerationInput } from "../types";

const CAUSE_CODES = [
  "INSUFFICIENT_FUNDS",
  "CARD_EXPIRED",
  "GATEWAY_TIMEOUT",
  "OTP_ABANDONED",
  "MANDATE_INSUFFICIENT_FUNDS",
  "MANDATE_LAPSED",
  "MANDATE_EXPIRED_CARD",
] as const;
const CHANNELS = ["EMAIL", "SMS"] as const;
const LANGUAGES = ["EN", "HINGLISH"] as const;

function baseInput(
  overrides: Partial<MessageGenerationInput> = {},
): MessageGenerationInput {
  return {
    caseId: "case_test_123",
    causeCode: "INSUFFICIENT_FUNDS",
    scenario: "CHECKOUT_DROPOFF",
    channel: "EMAIL",
    language: "EN",
    customerName: "Priya Sharma",
    merchantName: "Chai Point",
    amountPaise: 250000,
    currency: "INR",
    recoveryLink: "https://rzp.io/i/AbCdEfGh",
    attemptNumber: 1,
    ...overrides,
  };
}

describe("renderTemplateMessage — full coverage matrix", () => {
  for (const causeCode of CAUSE_CODES) {
    for (const channel of CHANNELS) {
      for (const language of LANGUAGES) {
        for (const attemptNumber of [1, 2]) {
          it(`${causeCode}/${channel}/${language} attempt ${attemptNumber} is well-formed`, () => {
            const input = baseInput({ causeCode, channel, language, attemptNumber });
            const result = renderTemplateMessage(input);

            expect(result.generatedBy).toBe("TEMPLATE");
            expect(result.body).toContain(input.merchantName);
            expect(result.body).toContain(formatAmountINR(input.amountPaise, input.currency));
            expect(result.body).toContain(input.recoveryLink);
            expect(result.body).not.toMatch(/\{\{.*\}\}/);
            expect(result.subject ?? "").not.toMatch(/\{\{.*\}\}/);

            if (channel === "SMS") {
              // SMS is brand-prefixed ("MerchantName: ...") rather than
              // personally addressed, to stay well under the length cap.
              expect(result.body.length).toBeLessThan(300);
            } else {
              expect(result.body).toContain(input.customerName);
              expect(result.subject).toBeTruthy();
            }
          });
        }
      }
    }
  }
});

describe("attempt-aware copy", () => {
  it("gives a retry message different copy than the first attempt", () => {
    const first = renderTemplateMessage(baseInput({ attemptNumber: 1 }));
    const retry = renderTemplateMessage(baseInput({ attemptNumber: 2 }));
    expect(retry.body).not.toBe(first.body);
  });
});

describe("MANDATE_LAPSED — must ask for re-authorization, never a blind retry", () => {
  it("never says 'try again' and does mention re-authorization", () => {
    const input = baseInput({
      causeCode: "MANDATE_LAPSED",
      scenario: "SUBSCRIPTION_FAILURE",
    });
    const result = renderTemplateMessage(input);
    const combined = `${result.subject ?? ""} ${result.body}`.toLowerCase();

    expect(combined).toMatch(/re-?authoriz/);
    expect(combined).not.toMatch(/try again/);
  });
});

describe("INVOICE_OVERDUE — graduated escalation templates", () => {
  const TIERS = ["FRIENDLY_NUDGE", "FIRM_REMINDER"] as const;

  for (const action of TIERS) {
    for (const channel of CHANNELS) {
      for (const language of LANGUAGES) {
        it(`${action}/${channel}/${language} is well-formed and cites real invoice facts`, () => {
          const input = baseInput({
            causeCode: "INVOICE_OVERDUE",
            scenario: "INVOICE_OVERDUE",
            channel,
            language,
            action,
            invoiceNumber: "INV-2026-0042",
            daysOverdue: 7,
            dueDateLabel: "12 Aug 2026",
          });
          const result = renderTemplateMessage(input);

          expect(result.body).toContain("INV-2026-0042");
          expect(result.body).toContain(formatAmountINR(input.amountPaise, input.currency));
          expect(result.body).toContain(input.recoveryLink);
          expect(result.body).not.toMatch(/\{\{.*\}\}/);
          if (channel === "SMS") {
            expect(result.body.length).toBeLessThan(300);
          }
        });
      }
    }
  }

  it("FIRM_REMINDER names the actual days-overdue count, FRIENDLY_NUDGE stays low-pressure", () => {
    const firm = renderTemplateMessage(
      baseInput({
        causeCode: "INVOICE_OVERDUE",
        scenario: "INVOICE_OVERDUE",
        action: "FIRM_REMINDER",
        invoiceNumber: "INV-2026-0007",
        daysOverdue: 9,
        dueDateLabel: "1 Aug 2026",
      }),
    );
    expect(firm.body).toContain("9");

    const nudge = renderTemplateMessage(
      baseInput({
        causeCode: "INVOICE_OVERDUE",
        scenario: "INVOICE_OVERDUE",
        action: "FRIENDLY_NUDGE",
        invoiceNumber: "INV-2026-0007",
        daysOverdue: 2,
        dueDateLabel: "20 Aug 2026",
      }),
    );
    expect(nudge.body).not.toBe(firm.body);
  });
});

describe("fallback template", () => {
  it("produces a valid message for an unknown cause code instead of crashing", () => {
    const input = baseInput({ causeCode: "SOME_FUTURE_CAUSE_CODE" });
    const result = renderTemplateMessage(input);

    expect(result.generatedBy).toBe("TEMPLATE");
    expect(result.body).toContain(input.customerName);
    expect(result.body).toContain(input.recoveryLink);
    expect(result.body).not.toMatch(/\{\{.*\}\}/);
  });

  it("falls back cleanly for an unknown cause code over SMS in Hinglish too", () => {
    const input = baseInput({
      causeCode: "SOME_FUTURE_CAUSE_CODE",
      channel: "SMS",
      language: "HINGLISH",
    });
    const result = renderTemplateMessage(input);

    expect(result.body).toContain(input.recoveryLink);
    expect(result.body.length).toBeLessThan(300);
  });
});
