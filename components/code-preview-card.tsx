"use client";

import { useState, useEffect } from "react";
import { Check, X, RotateCcw, FileCode, ChevronDown, ChevronUp, Loader2, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeDiff, type DiffLine } from "@/lib/diff";

export type CodeChange = {
  repo: string;
  path: string;
  oldContent: string;
  newContent: string;
  description: string;
  agentId: string;
  status: "pending" | "applied" | "rejected" | "rolled_back";
};

export function CodePreviewCard({
  change,
  onApprove,
  onReject,
}: {
  change: CodeChange;
  onApprove: (change: CodeChange) => void;
  onReject: (change: CodeChange) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<"diff" | "new">("diff");
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<{ version: string; timestamp: number }[]>([]);
  const [rollingBack, setRollingBack] = useState(false);

  const diff = computeDiff(change.oldContent, change.newContent);
  const addedCount = diff.filter((d) => d.type === "added").length;
  const removedCount = diff.filter((d) => d.type === "removed").length;
  const isPending = change.status === "pending";
  const isApplied = change.status === "applied";
  const isRejected = change.status === "rejected";

  async function loadVersions() {
    try {
      const res = await fetch(`/api/r2/versions?repo=${encodeURIComponent(change.repo)}&path=${encodeURIComponent(change.path)}`);
      const data = await res.json();
      if (data.versions) setVersions(data.versions);
    } catch {
      // ignore
    }
  }

  async function rollbackTo(timestamp: number) {
    setRollingBack(true);
    try {
      await fetch("/api/r2/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: change.repo, path: change.path, timestamp }),
      });
      setShowHistory(false);
    } finally {
      setRollingBack(false);
    }
  }

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-all animate-scale-in",
      isPending && "border-blue-500/40 bg-blue-500/5",
      isApplied && "border-green-500/40 bg-green-500/5",
      isRejected && "border-muted bg-muted/20 opacity-60",
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <FileCode className="h-4 w-4 text-blue-500" />
          <div>
            <span className="text-sm font-semibold">{change.description}</span>
            <span className="ml-2 text-xs text-muted-foreground font-mono">{change.path}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isPending && (
            <>
              <button
                onClick={() => onReject(change)}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </button>
              <button
                onClick={() => onApprove(change)}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Check className="h-3.5 w-3.5" />
                Apply Changes
              </button>
            </>
          )}
          {isApplied && (
            <>
              <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-500">
                <Check className="h-3.5 w-3.5" />
                Applied
              </span>
              <button
                onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadVersions(); }}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                <History className="h-3.5 w-3.5" />
                History
              </button>
            </>
          )}
          {isRejected && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <X className="h-3.5 w-3.5" />
              Rejected
            </span>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Diff stats */}
      {expanded && (
        <div className="flex items-center gap-3 border-t border-border/50 px-4 py-1.5">
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode("diff")}
              className={cn("rounded px-2 py-0.5 text-xs font-medium", viewMode === "diff" ? "bg-accent" : "text-muted-foreground")}
            >
              Diff
            </button>
            <button
              onClick={() => setViewMode("new")}
              className={cn("rounded px-2 py-0.5 text-xs font-medium", viewMode === "new" ? "bg-accent" : "text-muted-foreground")}
            >
              Full File
            </button>
          </div>
          <span className="text-xs text-green-600 dark:text-green-500">+{addedCount}</span>
          <span className="text-xs text-red-600 dark:text-red-500">-{removedCount}</span>
        </div>
      )}

      {/* Version history */}
      {showHistory && isApplied && (
        <div className="border-t border-border/50 px-4 py-2 bg-muted/20">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Version History</p>
          {versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No previous versions</p>
          ) : (
            <div className="space-y-1">
              {versions.slice(0, 5).map((v) => (
                <div key={v.version} className="flex items-center justify-between rounded-lg bg-background px-3 py-1.5">
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.timestamp).toLocaleString()}
                  </span>
                  <button
                    onClick={() => rollbackTo(v.timestamp)}
                    disabled={rollingBack}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-orange-600 hover:bg-orange-500/10 dark:text-orange-400"
                  >
                    {rollingBack ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    Rollback
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Code view */}
      {expanded && (
        <div className="border-t border-border/50 overflow-x-auto max-h-[400px] overflow-y-auto bg-[#1e1e2e]">
          {viewMode === "diff" ? (
            <DiffView diff={diff} />
          ) : (
            <pre className="selectable p-3 text-xs font-mono text-gray-200 whitespace-pre-wrap">
              {change.newContent}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: DiffLine[] }) {
  return (
    <div className="font-mono text-xs">
      {diff.map((line, i) => (
        <div
          key={i}
          className={cn(
            "flex px-3 py-0.5",
            line.type === "added" && "bg-green-500/15 text-green-300",
            line.type === "removed" && "bg-red-500/15 text-red-300",
            line.type === "unchanged" && "text-gray-400",
          )}
        >
          <span className="w-8 shrink-0 text-gray-600 select-none">
            {line.oldLine ?? ""}
          </span>
          <span className="w-8 shrink-0 text-gray-600 select-none">
            {line.newLine ?? ""}
          </span>
          <span className="w-4 shrink-0 select-none">
            {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
          </span>
          <span className="selectable whitespace-pre-wrap break-all">{line.content}</span>
        </div>
      ))}
    </div>
  );
}
