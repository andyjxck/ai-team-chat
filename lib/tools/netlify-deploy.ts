import { tool } from "ai";
import { z } from "zod";

const NETLIFY_API = "https://api.netlify.com/api/v1";

async function netlifyFetch(path: string, options: RequestInit = {}) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) throw new Error("NETLIFY_AUTH_TOKEN not configured");
  const res = await fetch(`${NETLIFY_API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Netlify API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export const netlifyDeploy = tool({
  description: "Check the deploy status of the ai-team-chat Netlify site. Since the site is connected to GitHub, every git push auto-deploys. Use this to check if the latest deploy succeeded.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name (for compatibility)"),
    message: z.string().optional().describe("Deploy message (ignored — deploys happen via Git push)"),
  }),
  execute: async ({ repo }) => {
    try {
      // Find the ai-team-chat site
      const sites = await netlifyFetch("/sites?filter=all") as { id: string; name: string; ssl_url: string; build_settings?: { repo_url?: string } }[];
      const site = sites.find((s) => s.name === "ai-team-chat");
      if (!site) {
        return { error: "ai-team-chat site not found on Netlify" };
      }

      // Get latest deploys
      const deploys = await netlifyFetch(`/sites/${site.id}/deploys?per_page=3`) as {
        id: string; state: string; created_at: string; message: string; deploy_url: string; unique_url: string; commit_sha?: string;
      }[];

      const latest = deploys[0];
      if (!latest) {
        return {
          success: true,
          siteUrl: site.ssl_url,
          message: `Site ${site.name} has no deploys yet. Push to GitHub to trigger a build.`,
          repo,
        };
      }

      return {
        success: true,
        siteUrl: site.ssl_url,
        latestDeploy: {
          id: latest.id,
          state: latest.state,
          message: latest.message,
          commitSha: latest.commit_sha?.slice(0, 7),
          url: latest.unique_url ?? latest.deploy_url,
          createdAt: latest.created_at,
        },
        recentDeploys: deploys.map((d) => ({
          state: d.state,
          message: d.message,
          createdAt: d.created_at,
        })),
        message: `Latest deploy on ${site.name}: ${latest.state}. ${latest.message}. Site: ${site.ssl_url}`,
        repo,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to check deploy status" };
    }
  },
});

export const netlifyListDeploys = tool({
  description: "List recent deploys on the ai-team-chat Netlify site.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const sites = await netlifyFetch("/sites?filter=all") as { id: string; name: string; ssl_url: string }[];
      const site = sites.find((s) => s.name === "ai-team-chat");
      if (!site) return { error: "ai-team-chat site not found" };

      const deploys = await netlifyFetch(`/sites/${site.id}/deploys?per_page=5`) as {
        id: string; state: string; created_at: string; message: string; deploy_url: string; unique_url: string;
      }[];
      return {
        siteUrl: site.ssl_url,
        deploys: deploys.map((d) => ({
          id: d.id,
          state: d.state,
          createdAt: d.created_at,
          message: d.message,
          url: d.unique_url ?? d.deploy_url,
        })),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to list deploys" };
    }
  },
});
