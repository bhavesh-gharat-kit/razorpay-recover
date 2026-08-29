/**
 * Razorpay API client — typed wrapper around the REST API using fetch.
 *
 * Uses basic auth (key_id:key_secret). No SDK dependency needed.
 *
 * If Razorpay keys are not configured, falls back to generating a
 * placeholder recovery link so the system remains demoable end-to-end.
 */

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatePaymentLinkParams {
  /** Amount in paise (smallest currency unit). */
  amountPaise: number;
  currency: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** Razorpay Payment Link expires at this Unix timestamp. */
  expireBy: number;
  /** The Case ID — stored as reference_id for traceability. */
  referenceId: string;
}

export interface PaymentLinkResult {
  ok: true;
  id: string; // plink_...
  shortUrl: string; // https://rzp.io/...
  /** Whether this is a real Razorpay link or a placeholder. */
  isPlaceholder: boolean;
}

export interface PaymentLinkStatus {
  ok: true;
  id: string;
  status: string;
  amountPaise: number;
  amountPaid: number;
}

export interface RazorpayError {
  ok: false;
  error: string;
  statusCode?: number;
}

export type RazorpayResult<T> = T | RazorpayError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isConfigured(): boolean {
  return env.RAZORPAY_KEY_ID.length > 0 && env.RAZORPAY_KEY_SECRET.length > 0;
}

function authHeader(): string {
  return (
    "Basic " +
    Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString(
      "base64",
    )
  );
}

const RAZORPAY_BASE = "https://api.razorpay.com/v1";

// ---------------------------------------------------------------------------
// createPaymentLink
// ---------------------------------------------------------------------------

export async function createPaymentLink(
  params: CreatePaymentLinkParams,
): Promise<RazorpayResult<PaymentLinkResult>> {
  if (!isConfigured()) {
    logger.warn(
      { referenceId: params.referenceId },
      "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured — returning placeholder link",
    );
    return {
      ok: true,
      id: `placeholder_plink_${params.referenceId}`,
      shortUrl: `https://example.com/pay/${params.referenceId}`,
      isPlaceholder: true,
    };
  }

  try {
    const body = {
      amount: params.amountPaise,
      currency: params.currency,
      description: params.description,
      customer: {
        name: params.customerName,
        email: params.customerEmail,
        contact: params.customerPhone,
      },
      notify: { email: false, sms: false },
      callback_url: env.RECOVERY_CALLBACK_URL,
      callback_method: "get",
      expire_by: params.expireBy,
      reference_id: params.referenceId,
    };

    const res = await fetch(`${RAZORPAY_BASE}/payment_links`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logger.error(
        { status: res.status, errBody },
        "razorpay createPaymentLink failed",
      );
      return {
        ok: false,
        error: `Razorpay API error ${res.status}: ${errBody}`,
        statusCode: res.status,
      };
    }

    const data = await res.json();
    return {
      ok: true,
      id: data.id,
      shortUrl: data.short_url,
      isPlaceholder: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "razorpay createPaymentLink exception");
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// fetchPaymentLinkStatus
// ---------------------------------------------------------------------------

export async function fetchPaymentLinkStatus(
  linkId: string,
): Promise<RazorpayResult<PaymentLinkStatus>> {
  if (!isConfigured()) {
    return {
      ok: false,
      error: "Razorpay keys not configured — cannot fetch link status",
    };
  }

  try {
    const res = await fetch(`${RAZORPAY_BASE}/payment_links/${linkId}`, {
      method: "GET",
      headers: { Authorization: authHeader() },
    });

    if (!res.ok) {
      const errBody = await res.text();
      return {
        ok: false,
        error: `Razorpay API error ${res.status}: ${errBody}`,
        statusCode: res.status,
      };
    }

    const data = await res.json();
    return {
      ok: true,
      id: data.id,
      status: data.status,
      amountPaise: data.amount,
      amountPaid: data.amount_paid,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "razorpay fetchPaymentLinkStatus exception");
    return { ok: false, error: message };
  }
}
