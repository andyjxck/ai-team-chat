import { tool } from "ai";
import { z } from "zod";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export const webFetch = tool({
  description:
    "Fetch a URL and extract its readable text content. Use this to read articles, audit web pages, extract information from a specific page, or verify lead contact info.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
  }),
  execute: async ({ url }) => {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return { error: `Fetch failed: ${res.status} ${res.statusText}` };
      }

      const html = await res.text();
      const { document } = parseHTML(html);
      const reader = new Readability(document as unknown as Document);
      const article = reader.parse();

      if (!article || !article.textContent) {
        // Fallback: return raw text stripped of tags
        const text = (document as unknown as HTMLElement).textContent?.trim().slice(0, 5000) ?? "";
        return { url, title: "Unknown", content: text || "No readable content found" };
      }

      return {
        url,
        title: article.title ?? "Unknown",
        content: article.textContent.slice(0, 10000),
        excerpt: article.excerpt ?? "",
      };
    } catch (err) {
      return {
        error: `Failed to fetch: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },
});
