import { tool } from "ai";
import { z } from "zod";

const NETLIFY_API = "https://api.netlify.com/api/v1";
const SITE_ID = "ea6b113b-3fa4-4da0-8ace-39e95feb2047";

async function netlifyFetch(path: string) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) throw new Error("NETLIFY_AUTH_TOKEN not configured");
  const res = await fetch(`${NETLIFY_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Netlify API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export const validateBuild = tool({
  description:
    "Wait for the latest Netlify deploy to finish and check if it succeeded. Use this AFTER calling github_edit_file to verify your changes didn't break the build. If the build failed, read the error log and fix the issue before completing your turn. This tool blocks until the deploy finishes (up to 90 seconds).",
  inputSchema: z.object({
    commitSha: z
      .string()
      .optional()
      .describe("The commit SHA from github_edit_file result (optional — if omitted, checks latest deploy)"),
  }),
  execute: async ({ commitSha }) => {
    try {
      // Poll until the latest deploy is no longer "building" or "enqueued"
      const maxAttempts = 5; // 5 x 5s = 25s max wait (must fit within 50s function limit)
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const deploys = (await netlifyFetch(
          `/sites/${SITE_ID}/deploys?per_page=5`,
        )) as {
          id: string;
          state: string;
          created_at: string;
          message: string;
          commit_sha?: string;
          error_message?: string;
          unique_url?: string;
        }[];

        if (!deploys || deploys.length === 0) {
          return { status: "no_deploys", message: "No deploys found." };
        }

        // Find the deploy matching the commit, or just use the latest
        let deploy = deploys[0];
        if (commitSha) {
          const match = deploys.find(
            (d) => d.commit_sha?.startsWith(commitSha.slice(0, 7)),
          );
          if (match) deploy = match;
        }

        const state = deploy.state;

        if (state === "ready") {
          return {
            status: "success",
            deployId: deploy.id,
            state: "ready",
            message: `Deploy succeeded. Site is live at https://ai-team-chat.netlify.app`,
            url: deploy.unique_url,
          };
        }

        if (state === "error") {
          return {
            status: "failed",
            deployId: deploy.id,
            state: "error",
            error: deploy.error_message ?? "Build failed",
            message: `Deploy FAILED. The build is broken. You MUST read the error and fix it. Error: ${deploy.error_message ?? "unknown"}`,
          };
        }

        // Still building — wait and retry
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      // Timed out waiting
      const deploys = (await netlifyFetch(
        `/sites/${SITE_ID}/deploys?per_page=1`,
      )) as { state: string; id: string }[];
      return {
        status: "timeout",
        message: `Deploy still building after 90s. Latest state: ${deploys[0]?.state ?? "unknown"}. Check again later.`,
      };
    } catch (err) {
      return {
        status: "error",
        error: err instanceof Error ? err.message : "Failed to check build",
      };
    }
  },
});
