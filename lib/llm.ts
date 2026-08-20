import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { nanoid } from "nanoid";

export type ModelProvider = "google" | "openai" | "anthropic" | "groq";

// Smart model for coding (2.5 Flash — paid, handles tools + code)
// Cheap model for casual chat (3.1 Flash Lite — free, 150K RPD)
const SMART_MODEL = "gemini-2.5-flash";
const CHEAP_MODEL = "gemini-3.1-flash-lite";

const SMART_FALLBACKS = [SMART_MODEL, "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const CHEAP_FALLBACKS = [CHEAP_MODEL, "gemini-2.0-flash-lite"];

// Pricing per 1M tokens (USD) — for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash": { input: 0.10, output: 0.40 },
  "gemini-2.5-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-3.1-flash-lite": { input: 0, output: 0 }, // free tier
};

// In-memory usage counters (reset on each serverless invocation)
// These get logged to Supabase for persistence
let usageBuffer: {
  model: string;
  tier: string;
  agentId?: string;
  chatId?: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}[] = [];

/**
 * Log an API call's usage to Supabase.
 * Called after each streamText completes.
 */
export async function logApiUsage(params: {
  model: string;
  tier: "smart" | "cheap";
  agentId?: string;
  chatId?: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}) {
  const pricing = MODEL_PRICING[params.model] ?? { input: 0, output: 0 };
  const cost = (params.inputTokens / 1_000_000 * pricing.input) + (params.outputTokens / 1_000_000 * pricing.output);

  // Log to console for debugging
  console.log(`[usage] ${params.model} | in:${params.inputTokens} out:${params.outputTokens} tools:${params.toolCalls} | $${cost.toFixed(6)}`);

  // Try to persist to Supabase (non-blocking, fail silently)
  try {
    const { supabase } = await import("@/db/client");
    await supabase.from("api_usage").insert({
      id: nanoid(),
      model: params.model,
      tier: params.tier,
      agent_id: params.agentId ?? null,
      chat_id: params.chatId ?? null,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      total_tokens: params.inputTokens + params.outputTokens,
      cost_usd: cost,
      tool_calls: params.toolCalls,
    });
  } catch (e) {
    // Table might not exist yet — fail silently
  }
}

/**
 * Get the model name that will be used for a given tier (for logging before the call).
 */
export function getModelName(tier: "smart" | "cheap" = "cheap"): string {
  if (tier === "smart") {
    return SMART_FALLBACKS[smartFallbackIndex] ?? SMART_FALLBACKS[0];
  }
  return CHEAP_FALLBACKS[cheapFallbackIndex] ?? CHEAP_FALLBACKS[0];
}

let smartFallbackIndex = 0;
let cheapFallbackIndex = 0;
let lastRateLimitTime = 0;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

function getGoogleClient() {
  return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });
}

export function getModel(tier: "smart" | "cheap" = "cheap"): LanguageModel {
  if (Date.now() - lastRateLimitTime > RATE_LIMIT_COOLDOWN_MS) {
    if (smartFallbackIndex > 0) smartFallbackIndex = 0;
    if (cheapFallbackIndex > 0) cheapFallbackIndex = 0;
  }

  const provider = process.env.AI_MODEL_ID?.split("/")[0] ?? "google";
  if (provider !== "google") {
    const primaryModel = process.env.AI_MODEL_ID?.split("/").slice(1).join("/") ?? SMART_MODEL;
    switch (provider as ModelProvider) {
      case "openai": {
        const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
        return openai(primaryModel) as unknown as LanguageModel;
      }
      case "anthropic": {
        const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
        return anthropic(primaryModel) as unknown as LanguageModel;
      }
      case "groq": {
        const groq = createGroq({ apiKey: process.env.GROQ_API_KEY ?? "" });
        return groq(primaryModel) as unknown as LanguageModel;
      }
    }
  }

  const google = getGoogleClient();
  if (tier === "smart") {
    const modelName = SMART_FALLBACKS[smartFallbackIndex] ?? SMART_FALLBACKS[0];
    if (smartFallbackIndex > 0) console.log(`[llm] Smart fallback: ${modelName}`);
    return google(modelName) as unknown as LanguageModel;
  } else {
    const modelName = CHEAP_FALLBACKS[cheapFallbackIndex] ?? CHEAP_FALLBACKS[0];
    if (cheapFallbackIndex > 0) console.log(`[llm] Cheap fallback: ${modelName}`);
    return google(modelName) as unknown as LanguageModel;
  }
}

export function advanceFallbackModel(tier: "smart" | "cheap" = "cheap") {
  lastRateLimitTime = Date.now();
  if (tier === "smart") {
    if (smartFallbackIndex < SMART_FALLBACKS.length - 1) {
      smartFallbackIndex++;
      console.log(`[llm] Smart rate limited! -> ${SMART_FALLBACKS[smartFallbackIndex]}`);
    }
  } else {
    if (cheapFallbackIndex < CHEAP_FALLBACKS.length - 1) {
      cheapFallbackIndex++;
      console.log(`[llm] Cheap rate limited! -> ${CHEAP_FALLBACKS[cheapFallbackIndex]}`);
    }
  }
}

export function markModelSuccess() {}

export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") || msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted");
}

export function isModelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("not found") || msg.includes("not supported") || msg.includes("deprecated") || msg.includes("invalid model") || msg.includes("model not") || msg.includes("404");
}

export function getFallbackStatus() {
  return {
    smartIndex: smartFallbackIndex,
    smartModel: SMART_FALLBACKS[smartFallbackIndex],
    cheapIndex: cheapFallbackIndex,
    cheapModel: CHEAP_FALLBACKS[cheapFallbackIndex],
    lastRateLimit: lastRateLimitTime > 0 ? new Date(lastRateLimitTime).toISOString() : null,
  };
}
