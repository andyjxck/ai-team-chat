import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";
import crypto from "node:crypto";
import { OAuth1Client } from "./oauth1";

export const socialPostX = tool({
  description:
    "Post a tweet to X/Twitter. ALWAYS confirm the tweet text with the user before posting. The tweet must be 280 characters or less.",
  inputSchema: z.object({
    text: z.string().max(280).describe("The tweet text (max 280 characters)"),
  }),
  execute: async ({ text }) => {
    const apiKey = process.env.X_API_KEY;
    const apiSecret = process.env.X_API_SECRET;
    const accessToken = process.env.X_ACCESS_TOKEN;
    const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      return { error: "X/Twitter API credentials not configured" };
    }
    if (apiKey.startsWith("replace_with")) {
      return { error: "X/Twitter API credentials not configured" };
    }

    try {
      // Use X API v2 to create a tweet
      const oauth = new OAuth1Client({
        consumerKey: apiKey,
        consumerSecret: apiSecret,
        token: accessToken,
        tokenSecret: accessTokenSecret,
      });

      const url = "https://api.twitter.com/2/tweets";
      const body = JSON.stringify({ text });

      const authHeader = oauth.sign({
        method: "POST",
        url,
        body,
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body,
      });

      const data = await res.json();

      if (!res.ok) {
        // Log the failed post
        await supabase.from("social_posts").insert({
          id: nanoid(),
          platform: "x",
          content: text,
          status: "failed",
        });
        return { error: `X API error: ${JSON.stringify(data)}` };
      }

      const tweetId = data.data?.id;

      // Log the successful post
      await supabase.from("social_posts").insert({
        id: nanoid(),
        platform: "x",
        content: text,
        externalId: tweetId,
        status: "posted",
      });

      return {
        success: true,
        tweetId,
        text,
        url: `https://x.com/i/web/status/${tweetId}`,
      };
    } catch (err) {
      return { error: `Failed to post: ${err instanceof Error ? err.message : "unknown error"}` };
    }
  },
});
