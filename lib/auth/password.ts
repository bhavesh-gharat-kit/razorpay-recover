/**
 * Password hashing helpers — one bcrypt cost factor across the app so
 * hashes stay compatible if the cost is ever changed here.
 *
 * Uses the pure-JS `bcryptjs` rather than the native `bcrypt` addon so the
 * code runs unchanged on serverless platforms that can't load native
 * builds. Hash format is identical, so existing hashes stay valid.
 */

import bcrypt from "bcryptjs";

/** bcrypt cost — 12 rounds is the modern default (~250ms on a modest VPS). */
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
