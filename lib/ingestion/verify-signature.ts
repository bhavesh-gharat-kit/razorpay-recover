/**
 * Razorpay webhook signature verification.
 *
 * Razorpay signs each webhook POST body with HMAC-SHA256 using the webhook
 * secret. The signature is sent in the `x-razorpay-signature` header as a
 * hex digest. We verify by computing the HMAC over the raw request body
 * (string, NOT parsed JSON) and comparing in constant time.
 *
 * Extracted as a pure function so it's testable without an HTTP request.
 */

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify a Razorpay webhook signature.
 *
 * @param rawBody  - The raw request body as a string (must NOT be re-serialized from parsed JSON).
 * @param signature - The value of the `x-razorpay-signature` header.
 * @param secret   - The webhook secret configured in the Razorpay dashboard.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyRazorpaySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  // Constant-time comparison to prevent timing attacks.
  // Both values are hex strings of the same hash algorithm, so they should
  // always be the same length if the signature is well-formed.
  const expectedBuf = Buffer.from(expected, "hex");
  const signatureBuf = Buffer.from(signature, "hex");

  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, signatureBuf);
}
