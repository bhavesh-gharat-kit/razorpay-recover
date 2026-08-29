/**
 * SMS/WhatsApp adapter stub — conforms to `ChannelAdapter` but doesn't call
 * a real provider. Logs what it would have sent and reports success so the
 * rest of the pipeline (DeliveryAttempt, case transitions) can be exercised
 * end-to-end before a real SMS/WhatsApp provider is wired up.
 *
 * TODO: replace with MSG91 or Twilio implementation when SMS channel is
 * needed — single-file swap (update `getChannelAdapter` in ./index.ts to
 * point SMS/WHATSAPP at the new adapter; the interface doesn't change).
 */

import { logger } from "@/lib/logger";
import type { ChannelAdapter, SendInput, SendResult } from "./types";

const BODY_PREVIEW_LENGTH = 60;

export const smsAdapterStub: ChannelAdapter = {
  async send(input: SendInput): Promise<SendResult> {
    const preview =
      input.body.length > BODY_PREVIEW_LENGTH
        ? `${input.body.slice(0, BODY_PREVIEW_LENGTH)}…`
        : input.body;

    logger.info(
      { channel: input.channel, to: input.to.phone ?? "unknown", preview },
      "smsAdapterStub: would send",
    );

    return {
      status: "SENT",
      providerRef: `stub-${crypto.randomUUID()}`,
    };
  },
};
