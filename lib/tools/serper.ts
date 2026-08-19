import { tool } from "ai";
import { z } from "zod";

export const serperSearch = tool({
  description:
    "Search Google for information. Returns titles, URLs, and snippets for the top results. Use this to research topics, find competitors, check rankings, or look up anything.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    num: z.number().optional().default(10).describe("Number of results (1-20)"),
  }),
  execute: async ({ query, num }) => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey || apiKey.startsWith("replace_with")) {
      return { error: "SERPER_API_KEY is not configured" };
    }

    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: Math.min(num, 20) }),
    });

    if (!res.ok) {
      return { error: `Serper API error: ${res.status} ${await res.text()}` };
    }

    const data = await res.json();
    const results = (data.organic ?? []).slice(0, num).map((r: { title: string; link: string; snippet: string }) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    }));

    return {
      query,
      results,
      knowledgeGraph: data.knowledgeGraph ?? null,
    };
  },
});
