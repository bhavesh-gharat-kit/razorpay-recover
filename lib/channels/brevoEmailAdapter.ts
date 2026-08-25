/**
 * Brevo transactional email adapter — the real, working send path for the
 * EMAIL channel.
 *
 * Calls Brevo's REST API directly with `fetch` (`POST
 * https://api.brevo.com/v3/smtp/email`) rather than pulling in their SDK,
 * which has version churn we don't need for one endpoint.
 *
 * Failure handling:
 *   - 2xx            -> SENT, providerRef = Brevo's messageId.
 *   - 4xx            -> FAILED, no retry (bad sender/recipient/payload —
 *                       retrying won't help).
 *   - 5xx            -> retry once after a 2s delay; FAILED if the retry
 *                       also fails.
 *   - network/timeout -> FAILED with errorDetail "network_error" (15s
 *                       timeout, no retry — the orchestrator's own
 *                       cooldown + rescheduling handles that).
 */

import { env } from "@/lib/env";
import type { ChannelAdapter, SendInput, SendResult } from "./types";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// Daily send counter — Brevo's free tier caps at 300 emails/day. Tracked
// in-memory (resets on process restart, which is fine: it's a demo-safety
// early-warning, not a hard limiter) and keyed off the current UTC date so
// it naturally resets at midnight UTC without a cron of its own.
// ---------------------------------------------------------------------------

/** Warn once the day's send count reaches this many. Overridable in tests. */
export let DAILY_WARNING_THRESHOLD = 250;

/** Test-only hook — production code never needs to change the threshold. */
export function setDailyWarningThresholdForTests(threshold: number): void {
  DAILY_WARNING_THRESHOLD = threshold;
}

function currentUTCDateKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

let dailyCounter = { dateKey: currentUTCDateKey(), count: 0 };

/** Test-only hook to reset counter state between test cases. */
export function resetDailyCounterForTests(): void {
  dailyCounter = { dateKey: currentUTCDateKey(), count: 0 };
}

function recordSentEmail(): void {
  const today = currentUTCDateKey();
  if (dailyCounter.dateKey !== today) {
    dailyCounter = { dateKey: today, count: 0 };
  }
  dailyCounter.count += 1;

  if (dailyCounter.count >= DAILY_WARNING_THRESHOLD) {
    console.warn(
      `[brevoEmailAdapter] ${dailyCounter.count} emails sent today (UTC) — ` +
        "approaching Brevo's free-tier limit of 300/day. Emails will start " +
        "failing once the limit is hit.",
    );
  }
}

// ---------------------------------------------------------------------------
// HTML email template
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Pull the recovery link out of the plain-text body for the CTA button. */
function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')]+/);
  return match ? match[0] : null;
}

function buildHtmlBody(input: SendInput): string {
  const merchantName = input.metadata?.merchantName ?? "";
  const recoveryLink = extractFirstUrl(input.body);

  const bodyHtml = escapeHtml(input.body)
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;">${para.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");

  const ctaHtml = recoveryLink
    ? `
      <div style="text-align:center;margin:28px 0;">
        <a href="${recoveryLink}"
           style="background-color:#3395FF;color:#ffffff;text-decoration:none;
                  padding:14px 32px;border-radius:6px;font-weight:600;
                  font-size:15px;display:inline-block;">
          Complete Your Payment
        </a>
      </div>`
    : "";

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px;border-bottom:1px solid #eef0f2;">
                <h1 style="margin:0;font-size:18px;color:#1a1a1a;">${escapeHtml(merchantName)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;color:#333333;font-size:15px;line-height:1.6;">
                ${bodyHtml}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px;color:#9aa0a6;font-size:12px;">
                Sent by ${escapeHtml(merchantName)} via Recover.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// Brevo API call
// ---------------------------------------------------------------------------

type AttemptOutcome =
  | { kind: "success"; messageId: string }
  | { kind: "client_error"; message: string }
  | { kind: "server_error"; message: string }
  | { kind: "network_error" };

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; code?: string };
    if (data?.message) return data.message;
    return JSON.stringify(data);
  } catch {
    return `Brevo API error ${res.status}`;
  }
}

async function attemptSend(input: SendInput): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: env.BREVO_SENDER_EMAIL,
          name: input.metadata?.merchantName,
        },
        to: [{ email: input.to.email, name: input.to.name }],
        subject: input.subject ?? "A message about your recent payment",
        htmlContent: buildHtmlBody(input),
      }),
      signal: controller.signal,
    });

    if (res.status >= 200 && res.status < 300) {
      const data = (await res.json()) as { messageId?: string };
      return { kind: "success", messageId: data.messageId ?? "" };
    }

    const message = await readErrorMessage(res);
    if (res.status >= 500) {
      return { kind: "server_error", message };
    }
    return { kind: "client_error", message };
  } catch {
    // Covers network failures and the AbortController timeout firing.
    return { kind: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const brevoEmailAdapter: ChannelAdapter = {
  async send(input: SendInput): Promise<SendResult> {
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
      console.error(
        "[brevoEmailAdapter] BREVO_API_KEY / BREVO_SENDER_EMAIL not " +
          "configured — cannot send email.",
      );
      return {
        status: "FAILED",
        errorDetail: "Brevo not configured (missing BREVO_API_KEY or BREVO_SENDER_EMAIL)",
      };
    }

    if (!input.to.email) {
      return { status: "FAILED", errorDetail: "No recipient email address" };
    }

    let outcome = await attemptSend(input);

    if (outcome.kind === "server_error") {
      console.warn(
        "[brevoEmailAdapter] Brevo returned a server error, retrying once " +
          `after ${RETRY_DELAY_MS}ms:`,
        outcome.message,
      );
      await wait(RETRY_DELAY_MS);
      outcome = await attemptSend(input);
    }

    switch (outcome.kind) {
      case "success":
        recordSentEmail();
        return { status: "SENT", providerRef: outcome.messageId };
      case "client_error":
        return { status: "FAILED", errorDetail: outcome.message };
      case "server_error":
        return { status: "FAILED", errorDetail: outcome.message };
      case "network_error":
        return { status: "FAILED", errorDetail: "network_error" };
    }
  },
};
