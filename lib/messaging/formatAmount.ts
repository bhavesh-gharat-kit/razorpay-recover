/**
 * Amount formatting for customer-facing messages.
 *
 * Money is stored as an integer number of paise everywhere in this
 * codebase (never floats). This is the one place that turns paise into a
 * human-readable, Indian-comma-grouped rupee string for outreach copy.
 */

/**
 * Format an amount stored in paise as an Indian-grouped currency string,
 * e.g. `250000` paise -> `"₹2,500"`, `10000000` paise -> `"₹1,00,000"`.
 *
 * `Intl.NumberFormat("en-IN")` already implements the lakh/crore grouping
 * (groups of 2 after the initial group of 3), so we lean on it rather
 * than hand-rolling comma placement.
 */
export function formatAmountINR(paise: number, currency: string): string {
  const units = paise / 100;

  // Most amounts are whole rupees; only show decimals when the paise
  // value isn't a clean multiple of 100 (e.g. a leftover 50 paise).
  const hasFraction = !Number.isInteger(units);

  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(units);

  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${formatted}`;
}
