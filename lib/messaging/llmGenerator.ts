/**
 * LLM-backed message generator — optional, off by default.
 *
 * Only relevant when `USE_LLM_DRAFTING=true` and `ANTHROPIC_API_KEY` is
 * set (see `lib/env.ts`, which refuses to boot with the flag on and no
 * key). The model's job is tone and phrasing ONLY — every fact
 * (customer name, merchant name, amount, recovery link) is handed to it
 * as a fixed value to reproduce verbatim, per CLAUDE.md's anti-hallucination
 * rule. If the call fails, times out, or the response drops the recovery
 * link, this falls back to the template generator rather than sending a
 * broken or fabricated message.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { formatAmountINR } from "./formatAmount";
import { renderTemplateMessage } from "./templateGenerator";
import type {
  MessageGenerationInput,
  MessageGenerationResult,
  MessageGenerator,
} from "./types";

/** Bump this whenever the prompt is meaningfully changed. */
export const PROMPT_VERSION = "v1.0";

const REQUEST_TIMEOUT_MS = 10_000;
const MODEL = "claude-3-5-haiku-20241022";

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const HINGLISH_STYLE_GUIDE = `
When language is HINGLISH, write in a natural, friendly, respectful Hindi-English
mix — the way a helpful support person would actually text, not a literal
machine transliteration. Good register: "Aapka payment complete nahi ho paya,
koi baat nahi, yahan se dobara try kar sakte hain." Avoid overly formal Hindi
and avoid pure English with Devanagari-style stiffness.
`.trim();

function buildSystemPrompt(input: MessageGenerationInput): string {
  const channelConstraint =
    input.channel === "SMS" || input.channel === "WHATSAPP"
      ? "The message is going out over SMS/WhatsApp — keep the full body under 300 characters."
      : "The message is an email — a short subject line plus a few short, friendly paragraphs is fine.";

  return `
You are drafting a payment recovery message on behalf of a merchant using
Razorpay. Tone rules, no exceptions:
- Be polite, calm, and non-pushy. NEVER use threatening or urgency language
  ("act now", "last chance", "immediately").
- Always refer to the merchant by name and always state the exact amount.
- Always include the recovery link as a clear call to action, reproduced
  EXACTLY as given — do not shorten, paraphrase, or invent a different URL.
- If this is a retry (attemptNumber > 1), open by gently acknowledging the
  earlier contact instead of repeating the first message verbatim.
- For a CARD_EXPIRED cause, suggest updating the payment method — retrying
  the same expired card will fail again.
- For an INSUFFICIENT_FUNDS cause, never say the customer doesn't have
  enough money — frame it as "the payment couldn't be processed".
- For a MANDATE_LAPSED cause (Phase 9), the subscription's auto-pay
  authorization itself has expired or was revoked — this is NOT fixed by
  retrying. Explicitly ask the customer to re-authorize; never say "try
  again" or imply a retry alone will work.
- For a MANDATE_EXPIRED_CARD cause, same as CARD_EXPIRED — ask the
  customer to add a new card, not just retry.
- For action FRIENDLY_NUDGE (Phase 9, invoice tier 1), keep it low-pressure
  and friendly — this invoice is only a few days overdue.
- For action FIRM_REMINDER (Phase 9, invoice tier 2), be professional and
  state the overdue fact plainly, but still never threaten — no "or else",
  no legal language, just a clear ask to avoid disruption to the account.

${HINGLISH_STYLE_GUIDE}

${channelConstraint}

These facts are fixed and MUST appear verbatim — do not alter, translate,
or re-derive them:
- customerName: ${input.customerName}
- merchantName: ${input.merchantName}
- amount: ${formatAmountINR(input.amountPaise, input.currency)}
- recoveryLink: ${input.recoveryLink}${
    input.invoiceNumber ? `\n- invoiceNumber: ${input.invoiceNumber}` : ""
  }${input.dueDateLabel ? `\n- dueDate: ${input.dueDateLabel}` : ""}${
    input.daysOverdue != null ? `\n- daysOverdue: ${input.daysOverdue}` : ""
  }

Respond with ONLY a JSON object, no markdown fences, no commentary:
${
  input.channel === "EMAIL"
    ? '{ "subject": "...", "body": "..." }'
    : '{ "body": "..." }'
}
`.trim();
}

function buildUserPrompt(input: MessageGenerationInput): string {
  return (
    `Draft a ${input.attemptNumber > 1 ? "follow-up" : "first"} recovery message ` +
    `for cause code ${input.causeCode}, channel ${input.channel}, language ${input.language}, ` +
    `attempt number ${input.attemptNumber}` +
    (input.action ? `, action ${input.action}` : "") +
    `.`
  );
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface ParsedLLMResponse {
  subject?: string;
  body: string;
}

function parseResponse(text: string): ParsedLLMResponse {
  // The model is instructed not to use markdown fences, but strip them
  // defensively in case it does anyway.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  const parsed = JSON.parse(cleaned) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).body !== "string"
  ) {
    throw new Error("LLM response missing a string `body` field");
  }

  const obj = parsed as Record<string, unknown>;
  return {
    subject: typeof obj.subject === "string" ? obj.subject : undefined,
    body: obj.body as string,
  };
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export const llmGenerator: MessageGenerator = {
  async generate(
    input: MessageGenerationInput,
  ): Promise<MessageGenerationResult> {
    try {
      const response = await getClient().messages.create(
        {
          model: MODEL,
          max_tokens: 512,
          system: buildSystemPrompt(input),
          messages: [{ role: "user", content: buildUserPrompt(input) }],
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("LLM response contained no text block");
      }

      const parsed = parseResponse(textBlock.text);

      // Safety check: if the model dropped the recovery link, the message
      // is useless — fall back rather than send it.
      if (!parsed.body.includes(input.recoveryLink)) {
        throw new Error("LLM response did not include the recovery link verbatim");
      }

      return {
        subject: parsed.subject,
        body: parsed.body,
        generatedBy: "LLM",
        promptVersion: PROMPT_VERSION,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[messaging] LLM drafting failed for case ${input.caseId} — ` +
          `falling back to template generator. Reason: ${reason}`,
      );
      return renderTemplateMessage(input);
    }
  },
};
