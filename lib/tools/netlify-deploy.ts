import { tool } from "ai";
import { z } from "zod";
import { r2ListRepoFiles, r2ReadRepoFile, r2Upload, r2CreateSnapshot, r2CleanupOldSnapshots } from "@/lib/r2/client";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const NETLIFY_API = "https://api.netlify.com/api/v1";

async function netlifyFetch(url: string, options: RequestInit = {}) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) throw new Error("NETLIFY_AUTH_TOKEN not configured");
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Netlify API error ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// Cache the coding site ID
let codingSiteId: string | null = null;

async function getCodingSite(): Promise<{ id: string; url: string; name: string }> {
  if (codingSiteId) {
    return { id: codingSiteId, url: "", name: "" };
  }
  const sites = await netlifyFetch(`${NETLIFY_API}/sites?filter=all`) as { id: string; name: string; ssl_url: string }[];
  const existing = sites.find((s) => s.name === "ai-team-chat-coding");
  if (existing) {
    codingSiteId = existing.id;
    return { id: existing.id, url: existing.ssl_url ?? `https://${existing.name}.netlify.app`, name: existing.name };
  }
  const created = await netlifyFetch(`${NETLIFY_API}/sites`, {
    method: "POST",
    body: JSON.stringify({ name: "ai-team-chat-coding" }),
  }) as { id: string; name: string; ssl_url: string };
  codingSiteId = created.id;
  return { id: created.id, url: created.ssl_url ?? `https://${created.name}.netlify.app`, name: created.name };
}

// Run a shell command and return output
async function runCommand(command: string, args: string[], cwd: string, timeout = 120000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      timeout,
      env: { ...process.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    proc.on("error", (err) => resolve({ stdout, stderr: err.message, exitCode: -1 }));
  });
}

export const netlifyDeploy = tool({
  description: "Deploy a repo from R2 storage to the coding team's Netlify site. This downloads the repo from R2, runs pnpm build, and uploads the built output to Netlify. Use this after making code changes.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name in R2 to deploy"),
    message: z.string().optional().describe("Deploy message / description of changes"),
  }),
  execute: async ({ repo, message }) => {
    const tmpDir = path.join(os.tmpdir(), `deploy-${repo}-${Date.now()}`);

    try {
      const site = await getCodingSite();

      // Create snapshot BEFORE deploying
      const snapshot = await r2CreateSnapshot(repo);
      await r2CleanupOldSnapshots(repo);

      // 1. Download all files from R2 to temp dir
      console.log(`[netlify_deploy] Downloading ${repo} from R2 to ${tmpDir}`);
      await fs.mkdir(tmpDir, { recursive: true });
      const files = await r2ListRepoFiles(repo);
      let fileCount = 0;
      for (const file of files) {
        const relativePath = file.key.replace(`repos/${repo}/`, "");
        if (relativePath.startsWith(".git/") || relativePath.startsWith("node_modules/")) continue;
        try {
          const content = await r2ReadRepoFile(repo, relativePath);
          const filePath = path.join(tmpDir, relativePath);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, "utf-8");
          fileCount++;
        } catch { /* skip */ }
      }

      if (fileCount === 0) {
        return { error: "No files found in repo" };
      }
      console.log(`[netlify_deploy] Downloaded ${fileCount} files`);

      // 2. Install dependencies
      console.log(`[netlify_deploy] Installing dependencies`);
      const installResult = await runCommand("pnpm", ["install", "--frozen-lockfile"], tmpDir, 120000);
      if (installResult.exitCode !== 0) {
        // Try npm install as fallback
        const npmResult = await runCommand("npm", ["install"], tmpDir, 120000);
        if (npmResult.exitCode !== 0) {
          return {
            error: `Failed to install dependencies. pnpm: ${installResult.stderr.slice(0, 500)} | npm: ${npmResult.stderr.slice(0, 500)}`,
            fileCount,
          };
        }
      }
      console.log(`[netlify_deploy] Dependencies installed`);

      // 3. Build the project
      console.log(`[netlify_deploy] Building project`);
      const buildResult = await runCommand("pnpm", ["build"], tmpDir, 120000);
      if (buildResult.exitCode !== 0) {
        return {
          error: `Build failed: ${buildResult.stderr.slice(0, 1000)}`,
          fileCount,
          buildStdout: buildResult.stdout.slice(0, 500),
        };
      }
      console.log(`[netlify_deploy] Build complete`);

      // 4. Collect built files from .next directory
      const buildDir = path.join(tmpDir, ".next");
      const builtFiles: Record<string, string> = {};

      // Read all files from .next recursively
      async function readDir(dir: string, baseDir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(baseDir, fullPath);
          if (entry.isDirectory()) {
            await readDir(fullPath, baseDir);
          } else {
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              builtFiles[relPath] = content;
            } catch {
              // Skip binary files
            }
          }
        }
      }

      // Also include static files from public/
      const publicDir = path.join(tmpDir, "public");
      try {
        await readDir(publicDir, tmpDir);
      } catch { /* no public dir */ }

      // Read .next built files
      try {
        await readDir(buildDir, tmpDir);
      } catch { /* no build dir */ }

      if (Object.keys(builtFiles).length === 0) {
        return { error: "Build produced no output files", fileCount, buildStdout: buildResult.stdout.slice(0, 500) };
      }

      console.log(`[netlify_deploy] Uploading ${Object.keys(builtFiles).length} built files to Netlify`);

      // 5. Create deploy on Netlify with file hashes
      const { createHash } = await import("crypto");
      const digests: Record<string, string> = {};
      for (const [filePath, content] of Object.entries(builtFiles)) {
        const hash = createHash("sha1").update(content).digest("hex");
        digests[filePath] = hash;
      }

      const deployRes = await netlifyFetch(`${NETLIFY_API}/sites/${site.id}/deploys`, {
        method: "POST",
        body: JSON.stringify({
          files: digests,
          message: message ?? `Deploy from coding team: ${repo}`,
        }),
      }) as { id: string; required: string[]; deploy_url: string; unique_url: string };

      // 6. Upload required files
      const required = deployRes.required ?? [];
      for (const filePath of required) {
        const content = builtFiles[filePath];
        if (!content) continue;
        const hash = createHash("sha1").update(content).digest("hex");
        await fetch(`${NETLIFY_API}/deploys/${deployRes.id}/files/${filePath}`, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`,
            "Content-Type": "application/octet-stream",
          },
          body: content,
        });
      }

      console.log(`[netlify_deploy] Deploy complete: ${deployRes.id}`);

      return {
        success: true,
        deployId: deployRes.id,
        siteUrl: site.url,
        deployUrl: deployRes.unique_url ?? deployRes.deploy_url,
        filesDeployed: Object.keys(builtFiles).length,
        sourceFiles: fileCount,
        snapshotId: snapshot.snapshotId,
        snapshotFiles: snapshot.fileCount,
        buildOutput: buildResult.stdout.slice(0, 500),
        message: `Built and deployed ${fileCount} source files (${Object.keys(builtFiles).length} built files) to ${site.url}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Deploy failed" };
    } finally {
      // Cleanup temp dir
      try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  },
});

export const netlifyListDeploys = tool({
  description: "List recent deploys on the coding team's Netlify site.",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const site = await getCodingSite();
      const deploys = await netlifyFetch(`${NETLIFY_API}/sites/${site.id}/deploys?per_page=5`) as {
        id: string; state: string; created_at: string; message: string; deploy_url: string; unique_url: string;
      }[];
      return {
        siteUrl: site.url,
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
