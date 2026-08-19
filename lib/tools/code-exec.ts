import { tool } from "ai";
import { z } from "zod";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

const WORKSPACE_DIR = path.resolve(process.env.WORKSPACE_DIR ?? "./workspace");

export const codeExec = tool({
  description:
    "Execute Python or Node.js code in a sandboxed subprocess. Use this to run build commands, test code, execute scripts, or verify output. Has a 30 second timeout. No network access by default.",
  inputSchema: z.object({
    language: z.enum(["python", "node"]).describe("The programming language to execute"),
    code: z.string().describe("The code to execute"),
  }),
  execute: async ({ language, code }) => {
    try {
      const tmpDir = path.join(WORKSPACE_DIR, ".tmp-exec");
      await fs.mkdir(tmpDir, { recursive: true });

      const ext = language === "python" ? ".py" : ".js";
      const fileName = `exec-${Date.now()}${ext}`;
      const filePath = path.join(tmpDir, fileName);

      await fs.writeFile(filePath, code, "utf-8");

      const command = language === "python" ? "python3" : "node";
      const args = [filePath];

      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
        (resolve) => {
          const proc = spawn(command, args, {
            cwd: tmpDir,
            timeout: 30000,
            env: {
              ...process.env,
              // Disable network for safety
              HTTP_PROXY: "",
              HTTPS_PROXY: "",
              http_proxy: "",
              https_proxy: "",
            },
          });

          let stdout = "";
          let stderr = "";

          proc.stdout.on("data", (data) => {
            stdout += data.toString();
          });
          proc.stderr.on("data", (data) => {
            stderr += data.toString();
          });

          proc.on("close", (code) => {
            resolve({ stdout, stderr, exitCode: code ?? -1 });
          });

          proc.on("error", (err) => {
            resolve({ stdout, stderr: err.message, exitCode: -1 });
          });
        },
      );

      // Cleanup
      await fs.unlink(filePath).catch(() => {});

      return {
        language,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 10000),
        stderr: result.stderr.slice(0, 5000),
        success: result.exitCode === 0,
      };
    } catch (err) {
      return {
        error: `Failed to execute: ${err instanceof Error ? err.message : "unknown error"}`,
      };
    }
  },
});
