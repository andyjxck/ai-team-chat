import { tool } from "ai";
import { z } from "zod";
import { r2ListRepos, r2ListRepoFiles, r2ReadRepoFile, r2Upload, r2Download, r2List } from "@/lib/r2/client";

export const r2ListRepositories = tool({
  description: "List all repositories stored in Cloudflare R2 storage. Use this to see what code repos are available for the user's projects.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const repos = await r2ListRepos();
      return { repos, count: repos.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to list repos" };
    }
  },
});

export const r2ListFiles = tool({
  description: "List files in a repository or directory stored in R2. Pass the repo name and optionally a subdirectory path.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    path: z.string().optional().describe("Optional subdirectory path within the repo, e.g. 'src/components'"),
  }),
  execute: async ({ repo, path }) => {
    try {
      const prefix = path ? `repos/${repo}/${path}` : `repos/${repo}/`;
      const files = await r2List(prefix);
      return {
        files: files.map((f) => ({
          path: f.key.replace(`repos/${repo}/`, ""),
          size: f.size,
          lastModified: f.lastModified?.toISOString(),
        })),
        count: files.length,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to list files" };
    }
  },
});

export const r2ReadFile = tool({
  description: "Read the contents of a specific file from a repository stored in R2.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path within the repo, e.g. 'src/index.ts'"),
  }),
  execute: async ({ repo, path }) => {
    try {
      const content = await r2ReadRepoFile(repo, path);
      return { path, content, size: content.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to read file" };
    }
  },
});

export const r2UploadFile = tool({
  description: "Upload a file to R2 storage. Useful for saving generated code, configs, or other files.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name to upload to"),
    path: z.string().describe("File path within the repo, e.g. 'src/index.ts'"),
    content: z.string().describe("File content as text"),
  }),
  execute: async ({ repo, path, content }) => {
    try {
      const key = `repos/${repo}/${path}`;
      await r2Upload(key, content);
      return { success: true, path: key, size: content.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to upload file" };
    }
  },
});

export const r2SearchFiles = tool({
  description: "Search for files in R2 storage by name pattern. Useful for finding specific files across repos.",
  inputSchema: z.object({
    query: z.string().describe("Search query — matches against file paths"),
    repo: z.string().optional().describe("Optional: limit search to a specific repo"),
  }),
  execute: async ({ query, repo }) => {
    try {
      const prefix = repo ? `repos/${repo}/` : "repos/";
      const allFiles = await r2List(prefix, 1000);
      const matched = allFiles.filter((f) =>
        f.key.toLowerCase().includes(query.toLowerCase()),
      );
      return {
        results: matched.map((f) => ({
          path: f.key,
          size: f.size,
          lastModified: f.lastModified?.toISOString(),
        })),
        count: matched.length,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Search failed" };
    }
  },
});
