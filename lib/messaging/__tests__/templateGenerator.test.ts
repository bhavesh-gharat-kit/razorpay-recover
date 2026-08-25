import { describe, it, expect } from "vitest";
import { renderTemplateMessage } from "../templateGenerator";
import { formatAmountINR } from "../formatAmount";
import type { MessageGenerationInput } from "../types";

const CAUSE_CODES = [
  "INSUFFICIENT_FUNDS",
  "CARD_EXPIRED",
  "GATEWAY_TIMEOUT",
  "OTP_ABANDONED",
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
