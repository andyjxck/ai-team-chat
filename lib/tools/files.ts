import { tool } from "ai";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { r2Upload, r2Download, r2List } from "@/lib/r2/client";

const WORKSPACE_DIR = path.resolve(process.env.WORKSPACE_DIR ?? "./workspace");
const R2_WORKSPACE_REPO = "workspace"; // R2 repo name for workspace files

function safePath(relativePath: string): string {
  const resolved = path.resolve(WORKSPACE_DIR, relativePath);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

// Check if local filesystem is writable (fails on Netlify serverless)
let localFsAvailable: boolean | null = null;
async function checkLocalFs(): Promise<boolean> {
  if (localFsAvailable !== null) return localFsAvailable;
  try {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });
    localFsAvailable = true;
  } catch {
    localFsAvailable = false;
  }
  return localFsAvailable;
}

export const fileRead = tool({
  description:
    "Read the contents of a file from the workspace. Use this to read existing files, code, documents, or any file an agent has created.",
  inputSchema: z.object({
    path: z.string().describe("Relative path within the workspace, e.g. 'websites/myproject/index.html'"),
  }),
  execute: async ({ path: relativePath }) => {
    try {
      // Try local first, then R2
      if (await checkLocalFs()) {
        try {
          const fullPath = safePath(relativePath);
          const content = await fs.readFile(fullPath, "utf-8");
          return { path: relativePath, content: content.slice(0, 50000) };
        } catch {
          // Fall through to R2
        }
      }
      // R2 fallback
      const content = await r2Download(`repos/${R2_WORKSPACE_REPO}/${relativePath}`);
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
      // Try local first, then R2
      if (await checkLocalFs()) {
        try {
          const fullPath = safePath(relativePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, "utf-8");
          return { success: true, path: relativePath, bytes: content.length };
        } catch {
          // Fall through to R2
        }
      }
      // R2 fallback
      await r2Upload(`repos/${R2_WORKSPACE_REPO}/${relativePath}`, content);
      return { success: true, path: relativePath, bytes: content.length, storage: "r2" };
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
      // Try local first
      if (await checkLocalFs()) {
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
        } catch {
          // Fall through to R2
        }
      }
      // R2 fallback
      const prefix = relativePath ? `repos/${R2_WORKSPACE_REPO}/${relativePath}/` : `repos/${R2_WORKSPACE_REPO}/`;
      const files = await r2List(prefix);
      // Extract unique top-level entries
      const entries = new Map<string, string>();
      for (const f of files) {
        const rel = f.key.replace(prefix, "");
        const topLevel = rel.split("/")[0];
        if (topLevel) {
          const isDir = rel.includes("/");
          entries.set(topLevel, isDir ? "directory" : "file");
        }
      }
      return {
        path: relativePath || "/",
        entries: Array.from(entries.entries()).map(([name, type]) => ({ name, type })),
      };
    } catch (err) {
      return { error: `Failed to list: ${err instanceof Error ? err.message : "unknown error"}` };
    }
  },
});
