import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

export type ModelProvider = "google" | "openai" | "anthropic" | "groq";

// Smart model for coding (2.5 Flash — paid, handles tools + code)
// Cheap model for casual chat (3.1 Flash Lite — free, 150K RPD)
const SMART_MODEL = "gemini-2.5-flash";
const CHEAP_MODEL = "gemini-3.1-flash-lite";

const SMART_FALLBACKS = [SMART_MODEL, "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const CHEAP_FALLBACKS = [CHEAP_MODEL, "gemini-2.0-flash-lite"];

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
