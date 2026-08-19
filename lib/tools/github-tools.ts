import { tool } from "ai";
import { z } from "zod";
import { listRepoFiles, readFile, createOrUpdateFile, getCommits, getGithubToken } from "@/lib/github/client";
import { supabase } from "@/db/client";

// Get opened repos for the user — NO hardcoded fallback
async function getOpenedRepos(): Promise<{ owner: string; name: string }[]> {
  const { data, error } = await supabase
    .from("github_repos")
    .select("owner, repo_name");

  if (error || !data || data.length === 0) {
    return [];
  }

  return (data as any[]).map((r) => ({ owner: r.owner, name: r.repo_name }));
}

// Check if a repo is opened — agents can only access opened repos
async function isRepoOpened(owner: string, repo: string): Promise<boolean> {
  const opened = await getOpenedRepos();
  return opened.some((r) => r.owner === owner && r.name === repo);
}

export const githubListRepos = tool({
  description: "List all GitHub repositories that the user has opened for agent access.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const repos = await getOpenedRepos();
      if (repos.length === 0) {
        return { repos: [], count: 0, error: "No repos opened. Tell the user to open repos on the Repos page first." };
      }
      return { repos, count: repos.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to list repos" };
    }
  },
});

export const githubListFiles = tool({
  description: "List files and directories in a GitHub repository. Use this to explore the repo structure. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    path: z.string().optional().describe("Directory path to list (empty for root)"),
  }),
  execute: async ({ owner, repo, path }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const files = await listRepoFiles(owner, repo, path ?? "");
      return { files, count: files.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to list files" };
    }
  },
});

export const githubReadFile = tool({
  description: "Read the contents of a file from a GitHub repository. ALWAYS read a file before editing it. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path (e.g. 'app/api/chat/route.ts')"),
  }),
  execute: async ({ owner, repo, path }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const content = await readFile(owner, repo, path);
      return { path, content, size: content.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to read file" };
    }
  },
});

export const githubEditFile = tool({
  description: "Edit or create a file in a GitHub repository. This creates a REAL commit and pushes it. Netlify will auto-build if connected. ALWAYS read the file first before editing. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path (e.g. 'app/api/chat/route.ts')"),
    content: z.string().describe("The FULL new content of the file (not a diff)"),
    message: z.string().optional().describe("Commit message (e.g. 'Fix auth bug in route.ts')"),
  }),
  execute: async ({ owner, repo, path, content, message }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const result = await createOrUpdateFile(
        owner,
        repo,
        path,
        content,
        message ?? `Update ${path}`,
      );
      return {
        success: true,
        path,
        commitSha: result.commit.sha,
        commitUrl: result.commit.html_url,
        message: `Committed ${path} to ${owner}/${repo}. Commit: ${result.commit.sha.slice(0, 7)}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to edit file" };
    }
  },
});

export const githubDeleteFile = tool({
  description: "Delete a file from a GitHub repository. This creates a real commit. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path to delete"),
    message: z.string().optional().describe("Commit message"),
  }),
  execute: async ({ owner, repo, path, message }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const { deleteFile } = await import("@/lib/github/client");
      await deleteFile(owner, repo, path, message ?? `Delete ${path}`);
      return { success: true, path, message: `Deleted ${path} from ${owner}/${repo}` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to delete file" };
    }
  },
});

export const githubGetCommits = tool({
  description: "List recent commits in a GitHub repository. Use this to see what changed recently. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    perPage: z.number().optional().describe("Number of commits to return (default 10)"),
  }),
  execute: async ({ owner, repo, perPage }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const commits = await getCommits(owner, repo, perPage ?? 10);
      return {
        commits: (commits as any[]).map((c) => ({
          sha: c.sha,
          message: c.commit.message,
          author: c.commit.author.name,
          date: c.commit.author.date,
          url: c.html_url,
        })),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to get commits" };
    }
  },
});

export const githubReview = tool({
  description: "Review code in a GitHub repository. Lists files and reads key source files to find bugs, issues, or improvements. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    focus: z.string().optional().describe("What to focus on (e.g. 'bugs', 'security', 'performance')"),
  }),
  execute: async ({ owner, repo, focus }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      // List root files
      const rootFiles = await listRepoFiles(owner, repo, "");
      const sourceFiles = rootFiles.filter((f) =>
        f.type === "file" && (f.path.endsWith(".ts") || f.path.endsWith(".tsx") || f.path.endsWith(".js") || f.path.endsWith(".json"))
      );

      // Read up to 5 key files
      const filesToRead = sourceFiles.slice(0, 5);
      const fileContents: { path: string; content: string }[] = [];
      for (const f of filesToRead) {
        try {
          const content = await readFile(owner, repo, f.path);
          fileContents.push({ path: f.path, content: content.slice(0, 5000) });
        } catch { /* skip */ }
      }

      return {
        rootFiles: rootFiles.map((f) => ({ name: f.name, path: f.path, type: f.type })),
        reviewedFiles: fileContents.map((f) => ({ path: f.path, size: f.content.length, preview: f.content.slice(0, 500) })),
        focus: focus ?? "all",
        note: `Reviewed ${fileContents.length} files in ${owner}/${repo}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to review code" };
    }
  },
});
