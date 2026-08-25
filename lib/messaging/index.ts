/**
 * Message generator factory — the single place that decides whether
 * drafting goes through the template engine (default) or the optional
 * Claude-backed path.
 */

import { env } from "@/lib/env";
import { templateGenerator } from "./templateGenerator";
import { llmGenerator } from "./llmGenerator";
import type { MessageGenerator } from "./types";

export function getMessageGenerator(): MessageGenerator {
  if (env.USE_LLM_DRAFTING && env.ANTHROPIC_API_KEY) {
    return llmGenerator;
  }
  return templateGenerator;
}

export * from "./types";
export { formatAmountINR } from "./formatAmount";
