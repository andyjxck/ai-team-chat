import { tool } from "ai";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";

const WORKSPACE_DIR = path.resolve(process.env.WORKSPACE_DIR ?? "./workspace");

function safePath(relativePath: string): string {
  const resolved = path.resolve(WORKSPACE_DIR, relativePath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

export const fileRead = tool({
  description:
    "Read the contents of a file from the workspace. Use this to read existing files, code, documents, or any file an agent has created.",
  inputSchema: z.object({
    path: z.string().describe("Relative path within the workspace, e.g. 'websites/myproject/index.html'"),
  }),
  execute: async ({ path: relativePath }) => {
    try {
      const fullPath = safePath(relativePath);
      const content = await fs.readFile(fullPath, "utf-8");
      return { path: relativePath, content: content.slice(0, 50000) };
    } catch (err) {
      return { error: `Failed to read: ${err instanceof Error ? err.message : "file not found"}` };
    }
  },
});

export const fileWrite = tool({
  description:
    "Write content to a file in the workspace. Creates directories as needed. Use this to save code, documents, reports, drafts, or any file output.",
  inputSchema: z.object({
    path: z.string().describe("Relative path within the workspace, e.g. 'websites/myproject/index.html'"),
    content: z.string().describe("The file content to write"),
  }),
  execute: async ({ path: relativePath, content }) => {
    try {
      const fullPath = safePath(relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      return { success: true, path: relativePath, bytes: content.length };
    } catch (err) {
      return { error: `Failed to write: ${err instanceof Error ? err.message : "unknown error"}` };
    }
  },
});

export const fileList = tool({
  description:
    "List files in a directory within the workspace. Returns file and folder names.",
  inputSchema: z.object({
    path: z.string().optional().default("").describe("Relative directory path within the workspace, e.g. 'websites/myproject'"),
  }),
  execute: async ({ path: relativePath }) => {
    try {
      const fullPath = safePath(relativePath || ".");
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return {
        path: relativePath || "/",
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
        })),
      };
    } catch (err) {
      return { error: `Failed to list: ${err instanceof Error ? err.message : "unknown error"}` };
    }
  },
});
