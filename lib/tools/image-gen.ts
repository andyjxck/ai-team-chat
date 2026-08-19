import { tool } from "ai";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const WORKSPACE_DIR = path.resolve(process.env.WORKSPACE_DIR ?? "./workspace");

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
      // Build Pollinations URL
      const encodedPrompt = encodeURIComponent(prompt);
      const seed = crypto.randomInt(0, 1000000);
      const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

      // Download the image to workspace
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) {
        return { error: `Image generation failed: ${res.status}` };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const mediaDir = path.join(WORKSPACE_DIR, "social-posts", "media");
      await fs.mkdir(mediaDir, { recursive: true });
      const fileName = `img-${Date.now()}.png`;
      const filePath = path.join(mediaDir, fileName);
      await fs.writeFile(filePath, buffer);

      return {
        success: true,
        prompt,
        localPath: `social-posts/media/${fileName}`,
        url: `/api/workspace/social-posts/media/${fileName}`,
        width,
        height,
      };
    } catch (err) {
      return {
        error: `Image generation failed: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },
});
