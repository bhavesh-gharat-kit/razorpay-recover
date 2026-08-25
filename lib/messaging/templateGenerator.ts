/**
 * Template-based message generator — the default, production path.
 *
 * Every factual field (customer name, merchant name, amount, recovery
 * link) is injected directly from the validated `MessageGenerationInput`
 * via TypeScript template literals — never string concatenation of
 * unvalidated data, never a hallucinated fact. `assertNoLeftoverPlaceholders`
 * is a defensive safety net: if any template author accidentally leaves a
 * `{{...}}` token in copy, generation fails loudly instead of shipping a
 * broken message.
 *
 * Tone guidelines applied throughout (see phases/05-message-generation.md):
 *   - never threaten or use urgency language
 *   - always name the merchant, always include the exact amount
 *   - always include the recovery link as a clear CTA
 *   - CARD_EXPIRED nudges the customer to update their payment method,
 *     not just retry — the same expired card will fail again
 *   - INSUFFICIENT_FUNDS is framed tactfully ("couldn't be processed"),
 *     never "you don't have enough money"
 *   - attempt 2+ opens with a gentle acknowledgment of the earlier contact
 *     instead of repeating the first message verbatim
 */

import { formatAmountINR } from "./formatAmount";
import type {
  MessageGenerationInput,
  MessageGenerationResult,
  MessageGenerator,
} from "./types";

type Language = MessageGenerationInput["language"];
type Channel = MessageGenerationInput["channel"];

interface TemplateOutput {
  subject?: string;
  body: string;
}

type TemplateFn = (input: MessageGenerationInput, amount: string) => TemplateOutput;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const isRetry = (input: MessageGenerationInput) => input.attemptNumber > 1;

function signOff(merchantName: string, language: Language): string {
  return language === "HINGLISH"
    ? `Dhanyawaad,\n${merchantName} team`
    : `Thanks,\n${merchantName} team`;
}

// ---------------------------------------------------------------------------
// INSUFFICIENT_FUNDS
// ---------------------------------------------------------------------------

const insufficientFundsEmailEN: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `We reached out earlier about your payment of ${amount} on ${input.merchantName} — it still hasn't gone through, so we wanted to check in again.`
    : `Your payment of ${amount} for your order on ${input.merchantName} couldn't be processed by your bank.`;
  return {
    subject: isRetry(input)
      ? `Following up: your payment on ${input.merchantName}`
      : `Your payment on ${input.merchantName} didn't go through`,
    body:
      `Hi ${input.customerName},\n\n${opening} Nothing has been charged.\n\n` +
      `You can complete it again here:\n${input.recoveryLink}\n\n` +
      `If anything's unclear, just reply and we'll help.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const insufficientFundsEmailHI: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `Humne pehle bhi ${input.merchantName} par aapke ${amount} ke payment ke baare mein bataya tha — abhi tak complete nahi hua hai, isliye dobara reminder bhej rahe hain.`
    : `${input.merchantName} par aapka ${amount} ka payment bank ki taraf se process nahi ho paya.`;
  return {
    subject: isRetry(input)
      ? `${input.merchantName} ka payment abhi bhi pending hai`
      : `${input.merchantName} par aapka payment complete nahi ho paya`,
    body:
      `Hi ${input.customerName},\n\n${opening} Koi charge nahi hua hai, chinta na karein.\n\n` +
      `Yahan se dobara try kar sakte hain:\n${input.recoveryLink}\n\n` +
      `Koi dikkat ho to bas reply kar dijiye, hum madad karenge.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const insufficientFundsSmsEN: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Following up on your ${amount} payment - it still hasn't gone through. Complete it here: ${input.recoveryLink}`
    : `${input.merchantName}: Your payment of ${amount} couldn't be processed. Complete it here: ${input.recoveryLink}`,
});

const insufficientFundsSmsHI: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Pehle bhi bataya tha - ${amount} ka payment abhi bhi pending hai. Yahan try karein: ${input.recoveryLink}`
    : `${input.merchantName}: Aapka ${amount} ka payment complete nahi ho paya. Yahan se dobara try karein: ${input.recoveryLink}`,
});

// ---------------------------------------------------------------------------
// CARD_EXPIRED — nudge to update the card, not just retry
// ---------------------------------------------------------------------------

const cardExpiredEmailEN: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `We reached out earlier about your ${amount} payment on ${input.merchantName} — the card on file has expired, so a new card is needed to complete it.`
    : `The card used for your payment of ${amount} on ${input.merchantName} has expired, so it couldn't go through.`;
  return {
    subject: isRetry(input)
      ? `Still need an updated card for your ${input.merchantName} payment`
      : `Update your card to complete your ${input.merchantName} payment`,
    body:
      `Hi ${input.customerName},\n\n${opening}\n\n` +
      `Please update your payment method and complete the payment here:\n${input.recoveryLink}\n\n` +
      `Let us know if you need any help.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const cardExpiredEmailHI: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `Humne pehle bhi bataya tha - ${input.merchantName} par ${amount} ke payment wala card expire ho chuka hai, isliye naya card add karna hoga.`
    : `${input.merchantName} par ${amount} ke payment ke liye jo card use hua tha uski validity khatam ho chuki hai, isliye payment complete nahi ho paya.`;
  return {
    subject: isRetry(input)
      ? `${input.merchantName} - naya card add karna baaki hai`
      : `${input.merchantName} ka payment complete karne ke liye card update karein`,
    body:
      `Hi ${input.customerName},\n\n${opening}\n\n` +
      `Naya card add karke yahan se payment complete karein:\n${input.recoveryLink}\n\n` +
      `Koi help chahiye to bata dijiyega.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const cardExpiredSmsEN: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Reminder - your card is expired so the ${amount} payment is still pending. Update it here: ${input.recoveryLink}`
    : `${input.merchantName}: Your card has expired, so your ${amount} payment couldn't complete. Update your card here: ${input.recoveryLink}`,
});

const cardExpiredSmsHI: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Pehle bhi bataya tha - card expired hai, ${amount} ka payment abhi bhi pending. Update karein: ${input.recoveryLink}`
    : `${input.merchantName}: Aapka card expire ho chuka hai, ${amount} ka payment pending hai. Naya card yahan add karein: ${input.recoveryLink}`,
});

// ---------------------------------------------------------------------------
// GATEWAY_TIMEOUT
// ---------------------------------------------------------------------------

const gatewayTimeoutEmailEN: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `We reached out earlier about your ${amount} payment on ${input.merchantName} — it looks like the technical issue is still blocking it from going through.`
    : `Your payment of ${amount} on ${input.merchantName} ran into a temporary technical issue at the payment gateway and didn't complete. This wasn't anything on your end.`;
  return {
    subject: isRetry(input)
      ? `Still working through a technical issue on your ${input.merchantName} payment`
      : `A technical hiccup on your ${input.merchantName} payment`,
    body:
      `Hi ${input.customerName},\n\n${opening}\n\n` +
      `You can try again here:\n${input.recoveryLink}\n\n` +
      `If it happens again, just reply and we'll take a closer look.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const gatewayTimeoutEmailHI: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `Humne pehle bhi bataya tha - ${input.merchantName} par ${amount} ka payment abhi bhi technical dikkat ki wajah se pending hai.`
    : `${input.merchantName} par aapka ${amount} ka payment gateway mein ek technical dikkat ki wajah se complete nahi ho paya. Ye aapki taraf se kuch galat nahi hua.`;
  return {
    subject: isRetry(input)
      ? `${input.merchantName} payment abhi bhi pending hai`
      : `${input.merchantName} payment mein technical dikkat aayi`,
    body:
      `Hi ${input.customerName},\n\n${opening}\n\n` +
      `Yahan se dobara try kar sakte hain:\n${input.recoveryLink}\n\n` +
      `Agar dobara ho to reply kijiye, hum dekh lenge.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const gatewayTimeoutSmsEN: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Following up - the ${amount} payment is still pending due to a technical issue. Try again here: ${input.recoveryLink}`
    : `${input.merchantName}: Your ${amount} payment hit a technical issue and didn't go through. Please try again here: ${input.recoveryLink}`,
});

const gatewayTimeoutSmsHI: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Pehle bhi bataya tha - ${amount} ka payment abhi bhi pending hai. Try karein: ${input.recoveryLink}`
    : `${input.merchantName}: Technical dikkat ki wajah se ${amount} ka payment nahi ho paya. Dobara try karein: ${input.recoveryLink}`,
});

// ---------------------------------------------------------------------------
// OTP_ABANDONED
// ---------------------------------------------------------------------------

const otpAbandonedEmailEN: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `We reached out earlier about your ${amount} payment on ${input.merchantName} — it's still showing as incomplete at the verification step.`
    : `Looks like your payment of ${amount} on ${input.merchantName} didn't go through — it seems the verification step wasn't completed.`;
  return {
    subject: isRetry(input)
      ? `Still one step away on your ${input.merchantName} payment`
      : `Complete your ${input.merchantName} payment — just one step left`,
    body:
      `Hi ${input.customerName},\n\n${opening}\n\n` +
      `You can finish it here:\n${input.recoveryLink}\n\n` +
      `Happy to help if you got stuck anywhere.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const otpAbandonedEmailHI: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `Humne pehle bhi bataya tha - ${input.merchantName} par ${amount} ka payment abhi bhi verification step par pending hai.`
    : `${input.merchantName} par aapka ${amount} ka payment complete nahi ho paya - verification step pura nahi ho saka.`;
  return {
    subject: isRetry(input)
      ? `${input.merchantName} ka payment abhi bhi ek step door hai`
      : `${input.merchantName} ka payment bas ek step door hai`,
    body:
      `Hi ${input.customerName},\n\n${opening}\n\n` +
      `Yahan se complete kar sakte hain:\n${input.recoveryLink}\n\n` +
      `Agar kahin atak gaye the to bataiye, madad kar denge.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const otpAbandonedSmsEN: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Your ${amount} payment is still pending at the verification step. Finish it here: ${input.recoveryLink}`
    : `${input.merchantName}: Your ${amount} payment is just one step away. Complete verification here: ${input.recoveryLink}`,
});

const otpAbandonedSmsHI: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Pehle bhi bataya tha - ${amount} ka payment verification step par pending hai. Yahan complete karein: ${input.recoveryLink}`
    : `${input.merchantName}: Aapka ${amount} ka payment bas ek step door hai. Yahan complete karein: ${input.recoveryLink}`,
});

// ---------------------------------------------------------------------------
// MANDATE_INSUFFICIENT_FUNDS (Phase 9) — recurring charge, low balance.
// Unlike a lapsed mandate, a retry is genuinely fine here — the mandate
// itself still works, the account just needs funds next time.
// ---------------------------------------------------------------------------

const mandateInsufficientFundsEmailEN: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `We reached out earlier about your ${input.merchantName} subscription — the recurring payment of ${amount} still hasn't gone through.`
    : `Your recurring payment of ${amount} for your ${input.merchantName} subscription couldn't be processed — it looks like there wasn't enough balance in the account at the time.`;
  return {
    subject: isRetry(input)
      ? `Still pending: your ${input.merchantName} subscription payment`
      : `Your ${input.merchantName} subscription payment didn't go through`,
    body:
      `Hi ${input.customerName},\n\n${opening} Nothing has been charged.\n\n` +
      `You can complete it and keep your subscription active here:\n${input.recoveryLink}\n\n` +
      `If anything's unclear, just reply and we'll help.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const mandateInsufficientFundsEmailHI: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `Humne pehle bhi ${input.merchantName} subscription ke ${amount} ke recurring payment ke baare mein bataya tha — abhi tak complete nahi hua hai.`
    : `${input.merchantName} subscription ka ${amount} ka recurring payment process nahi ho paya — lagta hai us waqt account mein balance kam tha.`;
  return {
    subject: isRetry(input)
      ? `${input.merchantName} subscription payment abhi bhi pending hai`
      : `${input.merchantName} subscription ka payment complete nahi ho paya`,
    body:
      `Hi ${input.customerName},\n\n${opening} Koi charge nahi hua hai, chinta na karein.\n\n` +
      `Subscription active rakhne ke liye yahan se complete kar sakte hain:\n${input.recoveryLink}\n\n` +
      `Koi dikkat ho to bas reply kar dijiye, hum madad karenge.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const mandateInsufficientFundsSmsEN: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Your subscription payment of ${amount} is still pending. Complete it here: ${input.recoveryLink}`
    : `${input.merchantName}: Your subscription payment of ${amount} couldn't be processed (low balance). Complete it here: ${input.recoveryLink}`,
});

const mandateInsufficientFundsSmsHI: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Subscription payment ${amount} abhi bhi pending hai. Yahan complete karein: ${input.recoveryLink}`
    : `${input.merchantName}: Balance kam hone ki wajah se ${amount} ka subscription payment nahi ho paya. Yahan complete karein: ${input.recoveryLink}`,
});

// ---------------------------------------------------------------------------
// MANDATE_LAPSED (Phase 9) — the mandate itself expired/was revoked.
// Critical distinction from every other template in this file: this must
// clearly ask for re-authorization, never "try again" — a customer who
// retries a lapsed mandate hits the exact same failure and loses trust.
// ---------------------------------------------------------------------------

const mandateLapsedEmailEN: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `We reached out earlier about your ${input.merchantName} subscription — the auto-pay authorization still needs to be renewed before the ${amount} payment can go through.`
    : `The auto-pay authorization (mandate) for your ${input.merchantName} subscription has expired, so the recurring payment of ${amount} could not go through.`;
  return {
    subject: isRetry(input)
      ? `Still need re-authorization for your ${input.merchantName} subscription`
      : `Please re-authorize your ${input.merchantName} subscription`,
    body:
      `Hi ${input.customerName},\n\n${opening} This isn't something a retry can fix — the ` +
      `authorization itself needs to be set up again.\n\n` +
      `Please re-authorize here to keep your subscription running:\n${input.recoveryLink}\n\n` +
      `It only takes a minute. Let us know if you need any help.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const mandateLapsedEmailHI: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `Humne pehle bhi bataya tha - ${input.merchantName} subscription ka auto-pay authorization abhi bhi renew karna baaki hai, tabhi ${amount} ka payment ho payega.`
    : `${input.merchantName} subscription ka auto-pay authorization (mandate) expire ho chuka hai, isliye ${amount} ka recurring payment nahi ho paya.`;
  return {
    subject: isRetry(input)
      ? `${input.merchantName} subscription - re-authorize karna baaki hai`
      : `${input.merchantName} subscription ko re-authorize karein`,
    body:
      `Hi ${input.customerName},\n\n${opening} Ye dobara try karne se theek nahi hoga - authorization ` +
      `dobara set up karna hoga.\n\n` +
      `Subscription chalu rakhne ke liye yahan se re-authorize karein:\n${input.recoveryLink}\n\n` +
      `Bas ek minute lagega. Koi help chahiye to bata dijiyega.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const mandateLapsedSmsEN: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Your subscription auto-pay still needs re-authorization (payment: ${amount}). Re-authorize here: ${input.recoveryLink}`
    : `${input.merchantName}: Your subscription auto-pay has expired, so ${amount} couldn't be charged. Please re-authorize here: ${input.recoveryLink}`,
});

const mandateLapsedSmsHI: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Subscription auto-pay abhi bhi re-authorize karna baaki hai (${amount}). Yahan karein: ${input.recoveryLink}`
    : `${input.merchantName}: Auto-pay expire ho gaya, ${amount} charge nahi hua. Re-authorize karein: ${input.recoveryLink}`,
});

// ---------------------------------------------------------------------------
// MANDATE_EXPIRED_CARD (Phase 9) — the card backing the mandate expired.
// Same spirit as CARD_EXPIRED: nudge to update the card, not just retry.
// ---------------------------------------------------------------------------

const mandateExpiredCardEmailEN: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `We reached out earlier about your ${input.merchantName} subscription — the card on file has expired, so a new card is still needed before the ${amount} payment can go through.`
    : `The card linked to your ${input.merchantName} subscription has expired, so the recurring payment of ${amount} couldn't go through.`;
  return {
    subject: isRetry(input)
      ? `Still need an updated card for your ${input.merchantName} subscription`
      : `Update your card to keep your ${input.merchantName} subscription active`,
    body:
      `Hi ${input.customerName},\n\n${opening}\n\n` +
      `Please add a new card to keep your subscription active:\n${input.recoveryLink}\n\n` +
      `Let us know if you need any help.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const mandateExpiredCardEmailHI: TemplateFn = (input, amount) => {
  const opening = isRetry(input)
    ? `Humne pehle bhi bataya tha - ${input.merchantName} subscription wala card expire ho chuka hai, ${amount} ka payment hone ke liye naya card add karna baaki hai.`
    : `${input.merchantName} subscription se juda card expire ho chuka hai, isliye ${amount} ka recurring payment nahi ho paya.`;
  return {
    subject: isRetry(input)
      ? `${input.merchantName} subscription - naya card add karna baaki hai`
      : `${input.merchantName} subscription active rakhne ke liye card update karein`,
    body:
      `Hi ${input.customerName},\n\n${opening}\n\n` +
      `Subscription active rakhne ke liye naya card add karein:\n${input.recoveryLink}\n\n` +
      `Koi help chahiye to bata dijiyega.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const mandateExpiredCardSmsEN: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Reminder - your subscription card is expired (payment: ${amount}). Update it here: ${input.recoveryLink}`
    : `${input.merchantName}: Your subscription card has expired, so ${amount} couldn't be charged. Update your card here: ${input.recoveryLink}`,
});

const mandateExpiredCardSmsHI: TemplateFn = (input, amount) => ({
  body: isRetry(input)
    ? `${input.merchantName}: Pehle bhi bataya tha - subscription card expired hai (${amount}). Update karein: ${input.recoveryLink}`
    : `${input.merchantName}: Subscription card expire ho gaya, ${amount} charge nahi hua. Naya card add karein: ${input.recoveryLink}`,
});

// ---------------------------------------------------------------------------
// INVOICE_OVERDUE — graduated escalation (Phase 9). Same causeCode at
// every tier, so these are keyed by `${causeCode}:${action}` in the
// registry below rather than by causeCode alone — see renderTemplateMessage.
// ---------------------------------------------------------------------------

/** `input.invoiceNumber`/`daysOverdue`/`dueDateLabel` are always set for
 * INVOICE_OVERDUE by the orchestrator — see executeScheduledAction. */
function invoiceFacts(input: MessageGenerationInput) {
  return {
    invoiceNumber: input.invoiceNumber ?? "your invoice",
    dueDateLabel: input.dueDateLabel ?? "the due date",
    daysOverdue: input.daysOverdue ?? 0,
  };
}

// Tier 1 — FRIENDLY_NUDGE: friendly, low-pressure.
const friendlyNudgeEmailEN: TemplateFn = (input, amount) => {
  const { invoiceNumber, dueDateLabel } = invoiceFacts(input);
  return {
    subject: `Friendly reminder: invoice ${invoiceNumber} from ${input.merchantName}`,
    body:
      `Hi ${input.customerName},\n\n` +
      `Just a reminder that invoice ${invoiceNumber} for ${amount} was due on ${dueDateLabel}. ` +
      `It's possible this simply slipped through — no worries either way.\n\n` +
      `You can settle it here whenever convenient:\n${input.recoveryLink}\n\n` +
      `Let us know if you have any questions about the invoice.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const friendlyNudgeEmailHI: TemplateFn = (input, amount) => {
  const { invoiceNumber, dueDateLabel } = invoiceFacts(input);
  return {
    subject: `Reminder: invoice ${invoiceNumber} - ${input.merchantName}`,
    body:
      `Hi ${input.customerName},\n\n` +
      `Bas ek reminder - invoice ${invoiceNumber} (${amount}) ki due date ${dueDateLabel} thi. ` +
      `Ho sakta hai ye bas nazar se chhoot gaya ho - koi baat nahi.\n\n` +
      `Jab bhi convenient ho, yahan se clear kar sakte hain:\n${input.recoveryLink}\n\n` +
      `Invoice ke baare mein koi sawaal ho to bataiye.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const friendlyNudgeSmsEN: TemplateFn = (input, amount) => {
  const { invoiceNumber, dueDateLabel } = invoiceFacts(input);
  return {
    body: `${input.merchantName}: Friendly reminder - invoice ${invoiceNumber} (${amount}) was due on ${dueDateLabel}. Pay here: ${input.recoveryLink}`,
  };
};

const friendlyNudgeSmsHI: TemplateFn = (input, amount) => {
  const { invoiceNumber, dueDateLabel } = invoiceFacts(input);
  return {
    body: `${input.merchantName}: Reminder - invoice ${invoiceNumber} (${amount}) ki due date ${dueDateLabel} thi. Yahan pay karein: ${input.recoveryLink}`,
  };
};

// Tier 2 — FIRM_REMINDER: professional, clear consequence, still not a threat.
const firmReminderEmailEN: TemplateFn = (input, amount) => {
  const { invoiceNumber, dueDateLabel, daysOverdue } = invoiceFacts(input);
  return {
    subject: `Action needed: invoice ${invoiceNumber} is ${daysOverdue} days overdue`,
    body:
      `Hi ${input.customerName},\n\n` +
      `Your payment of ${amount} for invoice ${invoiceNumber} (due ${dueDateLabel}) is now ${daysOverdue} days overdue. ` +
      `Please arrange payment to avoid any disruption to your account with ${input.merchantName}.\n\n` +
      `You can pay here:\n${input.recoveryLink}\n\n` +
      `If payment is already on its way, or if you'd like to arrange a payment date, just reply to this email.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

const firmReminderEmailHI: TemplateFn = (input, amount) => {
  const { invoiceNumber, dueDateLabel, daysOverdue } = invoiceFacts(input);
  return {
    subject: `Zaroori: invoice ${invoiceNumber} ${daysOverdue} din se overdue hai`,
    body:
      `Hi ${input.customerName},\n\n` +
      `Invoice ${invoiceNumber} (due ${dueDateLabel}) ka ${amount} ka payment ab ${daysOverdue} din se overdue hai. ` +
      `${input.merchantName} ke saath aapke account mein koi disruption avoid karne ke liye kripya payment arrange karein.\n\n` +
      `Yahan se pay kar sakte hain:\n${input.recoveryLink}\n\n` +
      `Agar payment already bhej diya hai, ya koi payment date arrange karni hai, to is email ka reply kar dijiye.\n\n` +
      signOff(input.merchantName, "HINGLISH"),
  };
};

const firmReminderSmsEN: TemplateFn = (input, amount) => {
  const { invoiceNumber, daysOverdue } = invoiceFacts(input);
  return {
    body: `${input.merchantName}: Invoice ${invoiceNumber} (${amount}) is ${daysOverdue} days overdue. Please pay to avoid disruption: ${input.recoveryLink}`,
  };
};

const firmReminderSmsHI: TemplateFn = (input, amount) => {
  const { invoiceNumber, daysOverdue } = invoiceFacts(input);
  return {
    body: `${input.merchantName}: Invoice ${invoiceNumber} (${amount}) ${daysOverdue} din se overdue hai. Disruption avoid karne ke liye pay karein: ${input.recoveryLink}`,
  };
};

// ---------------------------------------------------------------------------
// Registry — causeCode -> channel -> language -> template
// ---------------------------------------------------------------------------

const TEMPLATES: Record<
  string,
  Partial<Record<Channel, Partial<Record<Language, TemplateFn>>>>
> = {
  INSUFFICIENT_FUNDS: {
    EMAIL: { EN: insufficientFundsEmailEN, HINGLISH: insufficientFundsEmailHI },
    SMS: { EN: insufficientFundsSmsEN, HINGLISH: insufficientFundsSmsHI },
  },
  CARD_EXPIRED: {
    EMAIL: { EN: cardExpiredEmailEN, HINGLISH: cardExpiredEmailHI },
    SMS: { EN: cardExpiredSmsEN, HINGLISH: cardExpiredSmsHI },
  },
  GATEWAY_TIMEOUT: {
    EMAIL: { EN: gatewayTimeoutEmailEN, HINGLISH: gatewayTimeoutEmailHI },
    SMS: { EN: gatewayTimeoutSmsEN, HINGLISH: gatewayTimeoutSmsHI },
  },
  OTP_ABANDONED: {
    EMAIL: { EN: otpAbandonedEmailEN, HINGLISH: otpAbandonedEmailHI },
    SMS: { EN: otpAbandonedSmsEN, HINGLISH: otpAbandonedSmsHI },
  },

  // --- Subscription Failure (Phase 9) ---------------------------------
  MANDATE_INSUFFICIENT_FUNDS: {
    EMAIL: { EN: mandateInsufficientFundsEmailEN, HINGLISH: mandateInsufficientFundsEmailHI },
    SMS: { EN: mandateInsufficientFundsSmsEN, HINGLISH: mandateInsufficientFundsSmsHI },
  },
  MANDATE_LAPSED: {
    EMAIL: { EN: mandateLapsedEmailEN, HINGLISH: mandateLapsedEmailHI },
    SMS: { EN: mandateLapsedSmsEN, HINGLISH: mandateLapsedSmsHI },
  },
  MANDATE_EXPIRED_CARD: {
    EMAIL: { EN: mandateExpiredCardEmailEN, HINGLISH: mandateExpiredCardEmailHI },
    SMS: { EN: mandateExpiredCardSmsEN, HINGLISH: mandateExpiredCardSmsHI },
  },

  // --- B2B Invoice Overdue (Phase 9) — graduated escalation -----------
  // Keyed by `${causeCode}:${action}` since INVOICE_OVERDUE is the same
  // causeCode at every tier; see the composite key built in
  // renderTemplateMessage below.
  "INVOICE_OVERDUE:FRIENDLY_NUDGE": {
    EMAIL: { EN: friendlyNudgeEmailEN, HINGLISH: friendlyNudgeEmailHI },
    SMS: { EN: friendlyNudgeSmsEN, HINGLISH: friendlyNudgeSmsHI },
  },
  "INVOICE_OVERDUE:FIRM_REMINDER": {
    EMAIL: { EN: firmReminderEmailEN, HINGLISH: firmReminderEmailHI },
    SMS: { EN: firmReminderSmsEN, HINGLISH: firmReminderSmsHI },
  },
};

/**
 * Some causes need different copy depending on the orchestrator's chosen
 * action rather than just the causeCode — right now only INVOICE_OVERDUE's
 * graduated escalation, where causeCode is identical at every tier. Falls
 * back to the plain causeCode when there's no tier-specific action.
 */
const TIER_ACTIONS = new Set(["FRIENDLY_NUDGE", "FIRM_REMINDER"]);

function templateRegistryKey(input: MessageGenerationInput): string {
  return input.action && TIER_ACTIONS.has(input.action)
    ? `${input.causeCode}:${input.action}`
    : input.causeCode;
}

// ---------------------------------------------------------------------------
// Fallback — used whenever causeCode/channel/language has no coverage
// (important for Phase 9, when new cause codes are added ahead of copy).
// ---------------------------------------------------------------------------

const fallbackTemplate: TemplateFn = (input, amount) => {
  if (input.language === "HINGLISH") {
    const opening = isRetry(input)
      ? `Humne pehle bhi bataya tha - ${input.merchantName} par ${amount} ka payment abhi bhi complete nahi hua hai.`
      : `${input.merchantName} par aapka ${amount} ka payment complete nahi ho paya.`;
    if (input.channel === "SMS" || input.channel === "WHATSAPP") {
      return {
        body: `${input.merchantName}: ${opening} Yahan se dobara try karein: ${input.recoveryLink}`,
      };
    }
    return {
      subject: `${input.merchantName} ka payment complete nahi ho paya`,
      body:
        `Hi ${input.customerName},\n\n${opening} Koi charge nahi hua hai.\n\n` +
        `Yahan se dobara try kar sakte hain:\n${input.recoveryLink}\n\n` +
        `Koi help chahiye to reply kar dijiye.\n\n` +
        signOff(input.merchantName, "HINGLISH"),
    };
  }

  const opening = isRetry(input)
    ? `We reached out earlier about your ${amount} payment on ${input.merchantName} — it still hasn't gone through.`
    : `Your payment of ${amount} on ${input.merchantName} didn't go through.`;
  if (input.channel === "SMS" || input.channel === "WHATSAPP") {
    return {
      body: `${input.merchantName}: ${opening} Try again here: ${input.recoveryLink}`,
    };
  }
  return {
    subject: `Your payment on ${input.merchantName} didn't complete`,
    body:
      `Hi ${input.customerName},\n\n${opening} Nothing has been charged.\n\n` +
      `You can try again here:\n${input.recoveryLink}\n\n` +
      `If you need any help, just reply to this email.\n\n` +
      signOff(input.merchantName, "EN"),
  };
};

// ---------------------------------------------------------------------------
// Safety net
// ---------------------------------------------------------------------------

function assertNoLeftoverPlaceholders(output: TemplateOutput): void {
  const combined = `${output.subject ?? ""}\n${output.body}`;
  if (combined.includes("{{") || combined.includes("}}")) {
    throw new Error(
      "Template rendering left an unresolved {{...}} placeholder — refusing to send.",
    );
  }
}

// ---------------------------------------------------------------------------
// Public generator
// ---------------------------------------------------------------------------

export function renderTemplateMessage(
  input: MessageGenerationInput,
): MessageGenerationResult {
  const amount = formatAmountINR(input.amountPaise, input.currency);

  const registryKey = templateRegistryKey(input);
  const templateFn = TEMPLATES[registryKey]?.[input.channel]?.[input.language];

  let output: TemplateOutput;
  if (templateFn) {
    output = templateFn(input, amount);
  } else {
    console.warn(
      `[messaging] No template for causeCode=${input.causeCode} ` +
        `(registryKey=${registryKey}) channel=${input.channel} language=${input.language} — ` +
        `using fallback template. Consider adding dedicated copy for this combination.`,
    );
    output = fallbackTemplate(input, amount);
  }

  assertNoLeftoverPlaceholders(output);

  return {
    subject: output.subject,
    body: output.body,
    generatedBy: "TEMPLATE",
  };
}

export const templateGenerator: MessageGenerator = {
  generate(input: MessageGenerationInput): Promise<MessageGenerationResult> {
    return Promise.resolve(renderTemplateMessage(input));
  },
};
