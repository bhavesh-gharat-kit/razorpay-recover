import type { Scenario } from "@prisma/client";

/**
 * Color-coded pill for a RecoveryEvent's scenario (Phase 9) — used
 * anywhere a case row or case header needs to show which of the three
 * scenarios it belongs to (Case Explorer, Case Detail).
 */
const STYLES: Record<Scenario, string> = {
  CHECKOUT_DROPOFF: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  SUBSCRIPTION_FAILURE: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  INVOICE_OVERDUE: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
};

const LABELS: Record<Scenario, string> = {
  CHECKOUT_DROPOFF: "Checkout Drop-off",
  SUBSCRIPTION_FAILURE: "Subscription Failure",
  INVOICE_OVERDUE: "Invoice Overdue",
};

export function ScenarioBadge({ scenario }: { scenario: Scenario | string }) {
  const style = STYLES[scenario as Scenario] ?? STYLES.CHECKOUT_DROPOFF;
  const label = LABELS[scenario as Scenario] ?? scenario;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}
