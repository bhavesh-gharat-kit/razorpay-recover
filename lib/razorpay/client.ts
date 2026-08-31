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
// createOrder — used by the live /demo flow to open Razorpay Checkout
// ---------------------------------------------------------------------------

export interface CreateOrderParams {
  /** Amount in paise (smallest currency unit). */
  amountPaise: number;
  currency?: string;
  /** Merchant-side reference for this order (shown in the Razorpay dashboard). */
  receipt?: string;
  notes?: Record<string, string>;
}

export interface OrderResult {
  ok: true;
  id: string; // order_...
  amountPaise: number;
  /** Whether this is a real Razorpay order or a placeholder. */
  isPlaceholder: boolean;
}

export async function createOrder(
  params: CreateOrderParams,
): Promise<RazorpayResult<OrderResult>> {
  const currency = params.currency ?? "INR";
  const receipt =
    params.receipt ?? `demo_${Math.random().toString(36).slice(2, 10)}`;

  if (!isConfigured()) {
    logger.warn(
      { receipt },
      "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured — returning placeholder order",
    );
    return {
      ok: true,
      id: `placeholder_order_${receipt}`,
      amountPaise: params.amountPaise,
      isPlaceholder: true,
    };
  }

  try {
    const body = {
      amount: params.amountPaise,
      currency,
      receipt,
      notes: params.notes,
    };

    const res = await fetch(`${RAZORPAY_BASE}/orders`, {
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
        "razorpay createOrder failed",
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
      amountPaise: data.amount,
      isPlaceholder: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "razorpay createOrder exception");
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// fetchPayment — used by /api/demo/result to pull real error metadata
// ---------------------------------------------------------------------------

export interface PaymentDetails {
  ok: true;
  id: string;
  status: string;
  amountPaise: number;
  currency: string;
  method: string | null;
  email: string | null;
  contact: string | null;
  orderId: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  errorSource: string | null;
  errorStep: string | null;
  errorReason: string | null;
  createdAt: number | null;
}

export async function fetchPayment(
  paymentId: string,
): Promise<RazorpayResult<PaymentDetails>> {
  if (!isConfigured()) {
    return {
      ok: false,
      error: "Razorpay keys not configured — cannot fetch payment",
    };
  }

  try {
    const res = await fetch(`${RAZORPAY_BASE}/payments/${paymentId}`, {
      method: "GET",
      headers: { Authorization: authHeader() },
    });

    if (!res.ok) {
      const errBody = await res.text();
      logger.error(
        { status: res.status, errBody, paymentId },
        "razorpay fetchPayment failed",
      );
      return {
        ok: false,
        error: `Razorpay API error ${res.status}: ${errBody}`,
        statusCode: res.status,
      };
    }

    const d = await res.json();
    return {
      ok: true,
      id: d.id,
      status: d.status,
      amountPaise: d.amount,
      currency: d.currency,
      method: d.method ?? null,
      email: d.email ?? null,
      contact: d.contact ?? null,
      orderId: d.order_id ?? null,
      errorCode: d.error_code ?? null,
      errorDescription: d.error_description ?? null,
      errorSource: d.error_source ?? null,
      errorStep: d.error_step ?? null,
      errorReason: d.error_reason ?? null,
      createdAt: d.created_at ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "razorpay fetchPayment exception");
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
