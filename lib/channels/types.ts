/**
 * Channel adapter contracts.
 *
 * The orchestrator only ever depends on `ChannelAdapter` — never on a
 * concrete provider. `index.ts` is the single place that decides which
 * implementation backs a given `Channel`, mirroring the
 * `lib/messaging` generator factory pattern.
 */

export interface SendInput {
  channel: "EMAIL" | "SMS" | "WHATSAPP";
  to: { email?: string; phone?: string; name?: string };
  subject?: string;
  body: string;
  metadata?: {
    caseId: string;
    merchantName: string;
  };
}

export interface SendResult {
  status: "SENT" | "FAILED";
  /** e.g. Brevo message ID, or "stub-<uuid>" for unwired channels. */
  providerRef?: string;
  errorDetail?: string;
}

export interface ChannelAdapter {
  send(input: SendInput): Promise<SendResult>;
}
