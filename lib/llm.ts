import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

export type ModelProvider = "google" | "openai" | "anthropic" | "groq";

// Fallback chain — tried in order when rate limits hit
// All these models have free tiers on Google AI Studio
// Ordered from most capable to most economical
const GOOGLE_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
];

// Track which model index we're on
let currentFallbackIndex = 0;
let lastRateLimitTime = 0;
let lastSuccessTime = 0;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min before retrying earlier models

function getGoogleClient() {
  return createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY ?? "",
  });
}

/**
 * Returns the AI SDK model instance.
 * Uses the fallback chain — starts at the primary model, advances on rate limits.
 * After 5 minutes without a rate limit, tries to move back to earlier (cheaper) models.
 */
export function getModel(_modelIdOverride?: string): LanguageModel {
  // Check if we should reset the fallback index (cooldown passed)
  if (currentFallbackIndex > 0 && Date.now() - lastRateLimitTime > RATE_LIMIT_COOLDOWN_MS) {
    console.log(`[llm] Cooldown passed, resetting to primary model (was at index ${currentFallbackIndex})`);
    currentFallbackIndex = 0;
  }

  const provider = process.env.AI_MODEL_ID?.split("/")[0] ?? "google";
  const primaryModel = process.env.AI_MODEL_ID?.split("/").slice(1).join("/") ?? "gemini-2.5-flash";

  if (provider === "google") {
    const google = getGoogleClient();
    if (currentFallbackIndex > 0) {
      const fallbackName = GOOGLE_FALLBACK_MODELS[currentFallbackIndex] ?? GOOGLE_FALLBACK_MODELS[0];
      console.log(`[llm] Using fallback model: ${fallbackName} (index ${currentFallbackIndex})`);
      return google(fallbackName) as unknown as LanguageModel;
    }
    return google(primaryModel) as unknown as LanguageModel;
  }

  // For non-google providers, use them directly
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
    default:
      throw new Error(`Unknown model provider: ${provider}. Use google/openai/anthropic/groq as prefix in AI_MODEL_ID.`);
  }
}

/**
 * Call this when a rate limit error is encountered.
 * Advances to the next model in the fallback chain.
 */
export function advanceFallbackModel() {
  lastRateLimitTime = Date.now();
  if (currentFallbackIndex < GOOGLE_FALLBACK_MODELS.length - 1) {
    currentFallbackIndex++;
    console.log(`[llm] Rate limited! Advancing to fallback model: ${GOOGLE_FALLBACK_MODELS[currentFallbackIndex]}`);
  } else {
    console.log(`[llm] Rate limited! Already at last fallback model: ${GOOGLE_FALLBACK_MODELS[currentFallbackIndex]}`);
  }
}

/**
 * Call this when a request succeeds — tracks that the current model is working.
 */
export function markModelSuccess() {
  lastSuccessTime = Date.now();
}

/**
 * Check if an error is a rate limit error.
 */
export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") || msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted");
}

/**
 * Get the current fallback chain status (for debugging/health check).
 */
export function getFallbackStatus() {
  return {
    currentIndex: currentFallbackIndex,
    currentModel: GOOGLE_FALLBACK_MODELS[currentFallbackIndex] ?? GOOGLE_FALLBACK_MODELS[0],
    chain: GOOGLE_FALLBACK_MODELS,
    lastRateLimit: lastRateLimitTime > 0 ? new Date(lastRateLimitTime).toISOString() : null,
    lastSuccess: lastSuccessTime > 0 ? new Date(lastSuccessTime).toISOString() : null,
  };
}
