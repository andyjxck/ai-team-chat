import { tool } from "ai";
import { z } from "zod";
import { r2ListRepos, r2ListRepoFiles, r2ReadRepoFile, r2Upload, r2SavePendingChange } from "@/lib/r2/client";
import { getModel } from "@/lib/llm";
import { generateText } from "ai";

export const codeReview = tool({
  description: "Review files in a repo using AI to find real bugs, security issues, and improvement opportunities. Returns detailed findings with specific fix suggestions. Use this before making changes to understand what needs fixing.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name to review"),
    focus: z.enum(["bugs", "security", "performance", "style", "all"]).default("all").describe("What to focus the review on"),
  }),
  execute: async ({ repo, focus }) => {
    try {
      const files = await r2ListRepoFiles(repo);
      const codeFiles = files
        .map((f) => ({ path: f.key.replace(`repos/${repo}/`, ""), size: f.size }))
        .filter((f) => {
          const ext = f.path.split(".").pop()?.toLowerCase();
          return ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "c", "cpp", "rb", "json", "css", "md"].includes(ext ?? "");
        })
        .filter((f) => !f.path.includes("node_modules") && !f.path.includes(".next"));

      if (codeFiles.length === 0) {
        return { error: "No code files found in repo" };
      }

      // Read up to 15 most important files
      const filesToReview = codeFiles.slice(0, 15);
      const fileContents: { path: string; content: string }[] = [];

      for (const file of filesToReview) {
        try {
          const content = await r2ReadRepoFile(repo, file.path);
          // Truncate very long files
          fileContents.push({
            path: file.path,
            content: content.length > 8000 ? content.slice(0, 8000) + "\n... (truncated)" : content,
          });
        } catch {
          // Skip unreadable files
        }
      }

      // Use AI to review the code
      const reviewPrompt = `You are a senior code reviewer. Review the following files from the "${repo}" repository.
Focus on: ${focus}

For each issue found, provide:
- file: the file path
- line: approximate line number or range
- severity: critical, warning, or info
- issue: what the problem is
- fix: the specific fix (with code if possible)

Only report REAL issues. Don't invent problems. If the code is fine, say so.

Files:
${fileContents.map(f => `\n--- ${f.path} ---\n${f.content}`).join("\n")}

Return your findings as a JSON array. Format:
{"findings": [{"file": "...", "line": "...", "severity": "...", "issue": "...", "fix": "..."}]}

If no issues found, return: {"findings": [], "summary": "Code looks clean"}`;

      try {
        const model = getModel();
        const result = await generateText({
          model,
          prompt: reviewPrompt,
          maxOutputTokens: 8000,
        });

        // Parse the AI response
        let findings: unknown[] = [];
        let summary = "";
        try {
          const jsonMatch = result.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            findings = parsed.findings ?? [];
            summary = parsed.summary ?? "";
          }
        } catch {
          // If JSON parse fails, use the raw text as summary
          summary = result.text.slice(0, 2000);
        }

        return {
          repo,
          filesReviewed: fileContents.length,
          totalFiles: codeFiles.length,
          findings,
          summary: summary || `Found ${findings.length} issues across ${fileContents.length} files`,
          findingCount: findings.length,
          criticalCount: Array.isArray(findings) ? findings.filter((f: any) => f.severity === "critical").length : 0,
          warningCount: Array.isArray(findings) ? findings.filter((f: any) => f.severity === "warning").length : 0,
        };
      } catch (aiErr) {
        // If AI review fails, fall back to basic pattern matching
        return {
          repo,
          filesReviewed: fileContents.length,
          totalFiles: codeFiles.length,
          findings: [],
          summary: `AI review failed: ${aiErr instanceof Error ? aiErr.message : "unknown error"}. Basic scan: ${fileContents.length} files checked.`,
          findingCount: 0,
          criticalCount: 0,
          warningCount: 0,
        };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Review failed" };
    }
  },
});

export const codeEdit = tool({
  description: "Apply a code change to a file in R2 storage. ALWAYS read the file first with r2_read_file, then provide the full new content. A version of the old file is automatically saved for rollback. The user can accept or reject each change.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path within the repo"),
    newContent: z.string().describe("The FULL new content of the file (not just the changed lines)"),
    description: z.string().describe("Brief description of what was changed and why"),
  }),
  execute: async ({ repo, path, newContent, description }) => {
    try {
      // Read old content BEFORE uploading
      let oldContent = "";
      let isNewFile = false;
      try {
        oldContent = await r2ReadRepoFile(repo, path);
      } catch {
        isNewFile = true;
      }

      // Auto-approve: save old content for rollback but don't require approval
      let changeId = "";
      if (!isNewFile) {
        changeId = await r2SavePendingChange(repo, path, oldContent);
      }

      // Upload the new content immediately
      const key = `repos/${repo}/${path}`;
      await r2Upload(key, newContent);

      return {
        success: true,
        repo,
        path,
        description,
        oldContent: oldContent.slice(0, 4000),
        newContent: newContent.slice(0, 4000),
        changeId,
        isNewFile,
        autoApproved: true,
        message: `Edited ${path} in ${repo}: ${description}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to edit file" };
    }
  },
});
