import { tool } from "ai";
import { z } from "zod";
import { listRepoFiles, readFile, createOrUpdateFile, getCommits, getGithubToken, createBranch, createPullRequest, createIssue, searchCode, listBranches } from "@/lib/github/client";
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
  description: "Read the contents of a file from a GitHub repository. ALWAYS read a file before editing it. Only works on repos the user has opened. Large files are truncated to 15000 chars — if truncated, read the rest by reading specific line ranges or ask for a summary.",
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
      const MAX_CHARS = 15000;
      if (content.length > MAX_CHARS) {
        return {
          path,
          content: content.slice(0, MAX_CHARS),
          size: content.length,
          truncated: true,
          totalLines: content.split("\n").length,
          note: `File is ${content.length} chars (${content.split("\n").length} lines). Showing first ${MAX_CHARS} chars. The full file was read but truncated to save context. When editing, provide the COMPLETE file content based on what you read plus your changes.`,
        };
      }
      return { path, content, size: content.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to read file" };
    }
  },
});

export const githubEditFile = tool({
  description: "Edit or create a file in a GitHub repository. This creates a REAL Git commit and pushes it to GitHub. This is a REAL tool call, not text. CALL this tool — do not write its name in your text output. The content parameter must be the COMPLETE file content from line 1 to the end, not a diff or patch. Read the file first with github_read_file, then provide the full modified content here. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path (e.g. 'app/api/chat/route.ts')"),
    content: z.string().describe("The COMPLETE new file content — every single line, from the first line to the last. Not a diff. Not just the changed parts. The ENTIRE file."),
    message: z.string().optional().describe("Commit message (e.g. 'Fix auth bug in route.ts')"),
  }),
  execute: async ({ owner, repo, path, content, message }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      // Fetch the old content before updating (for diff display)
      let previousContent: string | null = null;
      try {
        previousContent = await readFile(owner, repo, path);
      } catch {
        // File might be new — that's fine
      }
      const result = await createOrUpdateFile(
        owner,
        repo,
        path,
        content,
        message ?? `Update ${path}`,
      );
      const oldLines = previousContent ? previousContent.split("\n").length : 0;
      const newLines = content.split("\n").length;
      return {
        success: true,
        path,
        commitSha: result.commit.sha,
        commitUrl: result.commit.html_url,
        isNew: !previousContent,
        oldLineCount: oldLines,
        newLineCount: newLines,
        addedLines: newLines - oldLines,
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

export const githubCreateBranch = tool({
  description: "Create a new branch in a GitHub repository. Use this before making changes if you want to work on a branch instead of main. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("New branch name (e.g. 'fix-auth-bug')"),
    fromBranch: z.string().optional().describe("Source branch to branch from (default: main)"),
  }),
  execute: async ({ owner, repo, branch, fromBranch }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const result = await createBranch(owner, repo, branch, fromBranch ?? "main");
      return {
        success: true,
        branch,
        fromBranch: fromBranch ?? "main",
        ref: result.ref,
        message: `Created branch '${branch}' from '${fromBranch ?? "main"}' in ${owner}/${repo}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to create branch" };
    }
  },
});

export const githubCreatePR = tool({
  description: "Create a pull request in a GitHub repository. Use this after pushing changes to a branch to request merging into main. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    title: z.string().describe("PR title"),
    head: z.string().describe("The branch containing changes (source)"),
    base: z.string().optional().describe("The branch to merge into (default: main)"),
    body: z.string().optional().describe("PR description — what changed and why"),
  }),
  execute: async ({ owner, repo, title, head, base, body }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const result = await createPullRequest(owner, repo, title, head, base ?? "main", body);
      return {
        success: true,
        number: result.number,
        url: result.html_url,
        state: result.state,
        message: `Created PR #${result.number}: ${title} (${head} -> ${base ?? "main"}) in ${owner}/${repo}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to create PR" };
    }
  },
});

export const githubCreateIssue = tool({
  description: "Create an issue in a GitHub repository. Use this to track bugs, feature requests, or tasks. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    title: z.string().describe("Issue title"),
    body: z.string().optional().describe("Issue description — what's the problem or what's needed?"),
    labels: z.array(z.string()).optional().describe("Labels to apply (e.g. ['bug', 'high-priority'])"),
  }),
  execute: async ({ owner, repo, title, body, labels }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const result = await createIssue(owner, repo, title, body, labels);
      return {
        success: true,
        number: result.number,
        url: result.html_url,
        state: result.state,
        message: `Created issue #${result.number}: ${title} in ${owner}/${repo}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to create issue" };
    }
  },
});

export const githubSearchCode = tool({
  description: "Search for code across a GitHub repository. Use this to find where a function, variable, or pattern is used. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
    query: z.string().describe("Search query (e.g. 'auth handler', 'function validateUser')"),
  }),
  execute: async ({ owner, repo, query }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const result = await searchCode(query, owner, repo);
      const items = (result.items ?? []).slice(0, 20).map((item: any) => ({
        file: item.path,
        url: item.html_url,
        score: item.score,
      }));
      return {
        results: items,
        count: items.length,
        totalCount: result.total_count ?? 0,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to search code" };
    }
  },
});

export const githubListBranches = tool({
  description: "List all branches in a GitHub repository. Only works on repos the user has opened.",
  inputSchema: z.object({
    owner: z.string().describe("Repo owner (username)"),
    repo: z.string().describe("Repository name"),
  }),
  execute: async ({ owner, repo }) => {
    try {
      if (!(await isRepoOpened(owner, repo))) {
        return { error: `Repo ${owner}/${repo} is not opened. Tell the user to open it on the Repos page first.` };
      }
      const branches = await listBranches(owner, repo);
      return {
        branches: (branches as any[]).map((b) => ({
          name: b.name,
          protected: b.protected,
          default: b.name === "main",
        })),
        count: branches.length,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to list branches" };
    }
  },
});
