import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";

export type ModelProvider = "google" | "openai" | "anthropic" | "groq";

/**
 * Returns the AI SDK model instance based on AI_MODEL_ID env var.
 * Format: "provider/model-name" e.g. "google/gemini-2.0-flash-exp"
 */
export function getModel(modelIdOverride?: string) {
  const modelId = modelIdOverride ?? process.env.AI_MODEL_ID ?? "google/gemini-2.0-flash-exp";
  const [provider, ...modelParts] = modelId.split("/");
  const modelName = modelParts.join("/");

  switch (provider as ModelProvider) {
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY ?? "",
      });
      return google(modelName);
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY ?? "",
      });
      return openai(modelName);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      });
      return anthropic(modelName);
    }
    case "groq": {
      const groq = createGroq({
        apiKey: process.env.GROQ_API_KEY ?? "",
      });
      return groq(modelName);
    }
    default:
      throw new Error(`Unknown model provider: ${provider}. Use google/openai/anthropic/groq as prefix in AI_MODEL_ID.`);
  }
}
