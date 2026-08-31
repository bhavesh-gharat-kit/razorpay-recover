"use client";

import { useState } from "react";
import { DemoCaseTimeline } from "@/components/DemoCaseTimeline";

const CHECKOUT_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";
const MIN_PAISE = 100;
const MAX_PAISE = 1_000_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: { email?: string; name?: string };
  notes?: Record<string, string>;
  handler?: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open(): void;
  on(
    event: "payment.failed",
    handler: (response: {
      error: {
        code: string;
        description: string;
        source: string;
        step: string;
        reason: string;
        metadata: { order_id: string; payment_id: string };
      };
    }) => void,
  ): void;
}

type RazorpayCtor = (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let checkoutScriptPromise: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.Razorpay) return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;

  checkoutScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      checkoutScriptPromise = null;
      reject(new Error("Failed to load Razorpay Checkout"));
    };
    document.head.appendChild(s);
  });
  return checkoutScriptPromise;
}

function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return "₹" + new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

interface DemoOrderResponse {
  orderId: string;
  keyId: string;
  amountPaise: number;
  currency: string;
  prefill: { email: string; name: string };
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export default function DemoPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [rupeeText, setRupeeText] = useState("499");
  const [scenario, setScenario] = useState<"failed" | "abandoned">("failed");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading"; message: string }
    | { kind: "error"; message: string }
    | { kind: "success_paid" }
    | { kind: "case"; caseId: string }
  >({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);

  const rupeeValue = Number(rupeeText);
  const amountPaise = Number.isFinite(rupeeValue)
    ? Math.round(rupeeValue * 100)
    : NaN;
  const amountOk =
    Number.isFinite(amountPaise) &&
    amountPaise >= MIN_PAISE &&
    amountPaise <= MAX_PAISE;
  const emailOk = EMAIL_RE.test(email.trim());
  const formOk = emailOk && amountOk && !submitting;

  async function reportResult(payload: {
    orderId: string;
    paymentId?: string;
    outcome: "failed" | "abandoned" | "dismissed";
  }) {
    const res = await fetch("/api/demo/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json: ApiEnvelope<{ caseId: string | null; state: string }> =
      await res.json();
    if (!json.ok) {
      throw new Error(json.error?.message ?? "Failed to report result");
    }
    return json.data;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formOk) return;
    setSubmitting(true);
    setStatus({ kind: "loading", message: "Creating order…" });

    try {
      // 1. Open a Razorpay Order
      const orderRes = await fetch("/api/demo/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          amountPaise,
          scenario,
        }),
      });
      const orderJson: ApiEnvelope<DemoOrderResponse> = await orderRes.json();
      if (!orderJson.ok || !orderJson.data) {
        setStatus({
          kind: "error",
          message:
            orderJson.error?.message ??
            "Couldn't create a demo order. Is Razorpay configured?",
        });
        setSubmitting(false);
        return;
      }
      const order = orderJson.data;

      // 2. Load Checkout script + open the modal
      setStatus({ kind: "loading", message: "Opening Razorpay Checkout…" });
      try {
        await loadCheckoutScript();
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load Checkout",
        });
        setSubmitting(false);
        return;
      }

      const RazorpayCtor = window.Razorpay!;
      const instance = RazorpayCtor({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "Recover Demo",
        description: `Test ${scenario} scenario`,
        prefill: order.prefill,
        notes: { demo: "true", scenario },
        handler: async (response) => {
          // Unexpected success — nothing to recover, but tidy up.
          void response;
          setStatus({ kind: "success_paid" });
          setSubmitting(false);
        },
        modal: {
          ondismiss: async () => {
            if (scenario !== "abandoned") {
              // The visitor dismissed the modal in the failed scenario
              // without a failed payment landing — record dismissal.
              try {
                await reportResult({
                  orderId: order.orderId,
                  outcome: "dismissed",
                });
              } catch {
                /* silent — this is only bookkeeping */
              }
              setStatus({ kind: "idle" });
              setSubmitting(false);
              return;
            }
            // Abandoned scenario — this is the intended outcome.
            setStatus({ kind: "loading", message: "Recording abandonment…" });
            try {
              const result = await reportResult({
                orderId: order.orderId,
                outcome: "abandoned",
              });
              if (result?.caseId) {
                setStatus({ kind: "case", caseId: result.caseId });
              } else {
                setStatus({
                  kind: "error",
                  message: "No case was created for this abandonment.",
                });
              }
            } catch (err) {
              setStatus({
                kind: "error",
                message: err instanceof Error ? err.message : "Failed",
              });
            } finally {
              setSubmitting(false);
            }
          },
        },
      });

      instance.on("payment.failed", async (response) => {
        const paymentId = response?.error?.metadata?.payment_id;
        if (!paymentId) {
          setStatus({
            kind: "error",
            message:
              "Razorpay reported a failure but no payment_id — nothing to ingest.",
          });
          setSubmitting(false);
          return;
        }
        setStatus({ kind: "loading", message: "Ingesting failed payment…" });
        try {
          const result = await reportResult({
            orderId: order.orderId,
            paymentId,
            outcome: "failed",
          });
          if (result?.caseId) {
            setStatus({ kind: "case", caseId: result.caseId });
          } else {
            setStatus({
              kind: "error",
              message: "No case id returned.",
            });
          }
        } catch (err) {
          setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed",
          });
        } finally {
          setSubmitting(false);
        }
      });

      instance.open();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Unexpected error",
      });
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold md:text-3xl">
          Live payment-failure demo
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          A real Razorpay test-mode checkout that, when the payment fails or is
          abandoned, runs Recover&apos;s full pipeline — detect → classify →
          Payment Link → drafted email → sent email — on that live event, and
          shows the audit timeline below as it happens.
        </p>
      </header>

      {status.kind !== "case" && (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6"
        >
          <div>
            <label className="block text-sm font-medium">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            {!emailOk && email.length > 0 && (
              <p className="mt-1 text-xs text-red-600">Enter a valid email.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">
              Amount (₹1 – ₹10,000)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-slate-500">₹</span>
              <input
                type="number"
                min="1"
                max="10000"
                step="0.01"
                required
                value={rupeeText}
                onChange={(e) => setRupeeText(e.target.value)}
                className="w-32 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {amountOk ? `= ${formatRupees(amountPaise)}` : "invalid"}
              </span>
            </div>
            {!amountOk && rupeeText.length > 0 && (
              <p className="mt-1 text-xs text-red-600">
                Amount must be between ₹1 and ₹10,000.
              </p>
            )}
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Scenario</legend>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="scenario"
                  value="failed"
                  checked={scenario === "failed"}
                  onChange={() => setScenario("failed")}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Failed payment</span> — pay with
                  a card and force the failure on the simulated bank page (see
                  How to test below).
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="scenario"
                  value="abandoned"
                  checked={scenario === "abandoned"}
                  onChange={() => setScenario("abandoned")}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Abandoned checkout</span> — open
                  Checkout and close the modal without paying.
                </span>
              </label>
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={!formOk}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            {submitting
              ? status.kind === "loading"
                ? status.message
                : "Working…"
              : "Open Razorpay Checkout"}
          </button>

          {status.kind === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {status.message}
            </p>
          )}
          {status.kind === "success_paid" && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              The payment succeeded — nothing to recover. Try again with the
              failure test method to see the recovery pipeline run.
            </p>
          )}
        </form>
      )}

      {status.kind === "case" && (
        <DemoCaseTimeline caseId={status.caseId} />
      )}

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 md:p-6">
        <h2 className="text-base font-semibold">How to test</h2>
        <p>
          Razorpay Checkout is running in <strong>test mode</strong> — no real
          money moves. To trigger the <em>Failed payment</em> scenario, pick
          any payment method in the modal and, on the simulated success/failure
          screen Razorpay presents, choose <strong>Failure</strong> (also
          labelled <em>Fail</em> on some flows). To trigger the{" "}
          <em>Abandoned checkout</em> scenario, open the modal and close it
          without paying.
        </p>
        <p>
          Refer to Razorpay&apos;s <em>Test Card Details</em> documentation for
          the current test card numbers if a method prompts for one — the
          numbers change occasionally, so check the docs rather than
          hardcoding.
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Amounts ≥ ₹5,000 are held for human review (a real merchant
            guardrail) — the timeline will show <code>pending_human_approval</code>
            and stop there instead of sending an email.
          </li>
          <li>
            The same email used 3× in a day trips the{" "}
            <code>MAX_CONTACTS_PER_CUSTOMER_PER_DAY</code> cap on the third
            send.
          </li>
          <li>
            If Brevo isn&apos;t configured the email doesn&apos;t leave, but a{" "}
            <code>DeliveryAttempt</code> row and the timeline entry are still
            written so the audit trail is complete.
          </li>
        </ul>
      </section>
    </div>
  );
}
