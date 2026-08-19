"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

type UploadState = {
  repo: string;
  current: number;
  total: number;
  status: string;
  active: boolean;
  done: boolean;
  error?: string;
};

type UploadContextValue = {
  upload: UploadState | null;
  startUpload: (files: FileList) => Promise<void>;
};

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used within UploadProvider");
  return ctx;
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [upload, setUpload] = useState<UploadState | null>(null);

  const startUpload = useCallback(async (fileList: FileList) => {
    console.log("[upload] startUpload called, files:", fileList.length);
    if (!fileList || fileList.length === 0) {
      console.log("[upload] No files, returning");
      return;
    }

    // Get repo name from the first file's relative path, or use a fallback
    const firstPath = fileList[0].webkitRelativePath || fileList[0].name;
    const repoName = firstPath.split("/")[0] || "uploaded-repo";

    const filesToUpload: { path: string; content: string }[] = [];
    let skipped = 0;

    for (const file of Array.from(fileList)) {
      const relativePath = file.webkitRelativePath || file.name;

      // If we have a webkitRelativePath, strip the first segment (folder name)
      // If we only have file.name, use it directly
      let pathParts: string;
      if (file.webkitRelativePath && file.webkitRelativePath.includes("/")) {
        pathParts = relativePath.split("/").slice(1).join("/");
      } else {
        pathParts = file.name;
      }

      if (!pathParts) {
        skipped++;
        continue;
      }

      if (pathParts.includes(".git/") || pathParts.includes("node_modules/") || pathParts.includes(".next/")) {
        skipped++;
        continue;
      }

      const textExts = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".css", ".html", ".xml", ".yml", ".yaml", ".toml", ".env", ".sh", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".sql", ".graphql", ".prisma", ".config", ".mjs", ".cjs", ".vue", ".svelte"];
      const hasTextExt = textExts.some((ext) => pathParts.toLowerCase().endsWith(ext));
      const isSmall = file.size < 500_000;

      if (!hasTextExt && !isSmall) {
        skipped++;
        continue;
      }

      try {
        const content = await file.text();
        filesToUpload.push({ path: pathParts, content });
      } catch {
        skipped++;
      }
    }

    if (filesToUpload.length === 0) {
      console.log("[upload] No uploadable files found, skipped:", skipped);
      setUpload({
        repo: repoName,
        current: 0,
        total: 0,
        status: `No uploadable files found (skipped ${skipped}). Try selecting a folder with code files.`,
        active: false,
        done: true,
        error: "No files to upload",
      });
      setTimeout(() => setUpload(null), 8000);
      return;
    }

    setUpload({
      repo: repoName,
      current: 0,
      total: filesToUpload.length,
      status: `Uploading ${filesToUpload.length} files (skipped ${skipped})...`,
      active: true,
      done: false,
    });
    console.log("[upload] Starting upload of", filesToUpload.length, "files to", repoName);

    let uploaded = 0;
    let failed = 0;
    const errors: string[] = [];

    // Upload in batches of 10 for speed
    const BATCH_SIZE = 10;
    for (let i = 0; i < filesToUpload.length; i += BATCH_SIZE) {
      const batch = filesToUpload.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const res = await fetch("/api/r2/upload-repo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repoName, files: [file] }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(`${file.path}: ${data.error || res.status}`);
          }
          return file.path;
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          uploaded++;
        } else {
          errors.push(result.reason instanceof Error ? result.reason.message : "failed");
          failed++;
        }
      }

      setUpload({
        repo: repoName,
        current: uploaded + failed,
        total: filesToUpload.length,
        status: `Uploading ${repoName}... (${uploaded} ok, ${failed} failed)`,
        active: true,
        done: false,
      });
    }

    setUpload({
      repo: repoName,
      current: uploaded,
      total: filesToUpload.length,
      status: failed > 0
        ? `Uploaded ${uploaded}/${filesToUpload.length} files to ${repoName} (${failed} failed: ${errors.slice(0, 3).join(", ")})`
        : `Uploaded ${uploaded}/${filesToUpload.length} files to ${repoName}`,
      active: false,
      done: true,
      error: failed > 0 ? errors.join("; ") : undefined,
    });

    // Clear after 8 seconds
    setTimeout(() => setUpload(null), 8000);
  }, []);

  return (
    <UploadContext.Provider value={{ upload, startUpload }}>
      {children}
    </UploadContext.Provider>
  );
}
