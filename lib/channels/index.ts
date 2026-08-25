/**
 * Channel adapter factory — the single place that decides which concrete
 * `ChannelAdapter` backs a given `Channel`. Mirrors the
 * `lib/messaging` generator factory pattern.
 */

import { brevoEmailAdapter } from "./brevoEmailAdapter";
import { smsAdapterStub } from "./smsAdapterStub";
import type { ChannelAdapter } from "./types";

export function getChannelAdapter(
  channel: "EMAIL" | "SMS" | "WHATSAPP",
): ChannelAdapter {
  switch (channel) {
    case "EMAIL":
      return brevoEmailAdapter;
    case "SMS":
    case "WHATSAPP":
      return smsAdapterStub;
  }
}

export * from "./types";
