import { tool } from "ai";
import { z } from "zod";
import crypto from "node:crypto";

export const imageGen = tool({
  description:
    "Generate an image from a text prompt using Pollinations.ai (free, no API key needed). Returns the URL of the generated image. Use this to create images for social media posts, mockups, or visual content.",
  inputSchema: z.object({
    prompt: z.string().describe("Description of the image to generate"),
    width: z.number().optional().default(1024).describe("Image width in pixels"),
    height: z.number().optional().default(1024).describe("Image height in pixels"),
  }),
  execute: async ({ prompt, width, height }) => {
    try {
      const encodedPrompt = encodeURIComponent(prompt);
      const seed = crypto.randomInt(0, 1000000);
      const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

      // Just return the URL — the image is generated on-demand when loaded
      // No need to download and store it (which doesn't work on serverless anyway)
      return {
        success: true,
        prompt,
        url,
        width,
        height,
        note: "Image URL is ready. The image is generated when the URL is loaded in a browser or app.",
      };
    } catch (err) {
      return {
        error: `Image generation failed: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },
});
