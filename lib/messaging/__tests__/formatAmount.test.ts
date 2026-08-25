import { describe, it, expect } from "vitest";
import { formatAmountINR } from "../formatAmount";

describe("formatAmountINR", () => {
  it("formats 250000 paise as ₹2,500", () => {
    expect(formatAmountINR(250000, "INR")).toBe("₹2,500");
  });

  it("formats 2500000 paise as ₹25,000", () => {
    expect(formatAmountINR(2500000, "INR")).toBe("₹25,000");
  });

  it("formats 100 paise as ₹1", () => {
    expect(formatAmountINR(100, "INR")).toBe("₹1");
  });

  it("uses Indian lakh grouping for large amounts (₹1,00,000 not ₹100,000)", () => {
    expect(formatAmountINR(10_000_000, "INR")).toBe("₹1,00,000");
  });

  it("shows two decimals for a fractional-rupee amount", () => {
    expect(formatAmountINR(150, "INR")).toBe("₹1.50");
  });

  it("prefixes non-INR currency codes instead of ₹", () => {
    expect(formatAmountINR(500, "USD")).toBe("USD 5");
  });
});
