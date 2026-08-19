"use client";

import { useState, useEffect } from "react";
import { Check, X, RotateCcw, FileCode, ChevronDown, ChevronUp, Loader2, History, GitBranch, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeDiff, type DiffLine } from "@/lib/diff";

export type FileChange = {
  repo: string;
  path: string;
  oldContent: string;
  newContent: string;
  description: string;
  status: "pending" | "approved" | "rejected" | "applied";
};

export function ChangeReviewCard({
  changes,
  agentName,
  onApproveAll,
  onRejectAll,
  onApproveOne,
  onRejectOne,
}: {
  changes: FileChange[];
  agentName: string;
  onApproveAll?: () => void;
  onRejectAll?: () => void;
  onApproveOne?: (index: number) => void;
  onRejectOne?: (index: number) => void;
}) {
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"diff" | "new">("diff");

  const pendingCount = changes.filter((c) => c.status === "pending").length;
  const approvedCount = changes.filter((c) => c.status === "approved" || c.status === "applied").length;
  const rejectedCount = changes.filter((c) => c.status === "rejected").length;
  const allPending = pendingCount === changes.length;
  const allResolved = pendingCount === 0;

  function toggleFile(idx: number) {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 overflow-hidden animate-scale-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-4 w-4 text-blue-500" />
          <div>
            <span className="text-sm font-semibold">{agentName} proposed {changes.length} change{changes.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-2 mt-0.5">
              {pendingCount > 0 && <span className="text-xs text-blue-600 dark:text-blue-400">{pendingCount} pending</span>}
              {approvedCount > 0 && <span className="text-xs text-green-600 dark:text-green-500">{approvedCount} approved</span>}
              {rejectedCount > 0 && <span className="text-xs text-red-600 dark:text-red-500">{rejectedCount} rejected</span>}
            </div>
          </div>
        </div>
        {allPending && (
          <div className="flex items-center gap-2">
            <button
              onClick={onRejectAll}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent border border-border/50"
            >
              <X className="h-3.5 w-3.5" />
              Reject All
            </button>
            <button
              onClick={onApproveAll}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Check className="h-3.5 w-3.5" />
              Approve All
            </button>
          </div>
        )}
        {allResolved && (
          <span className="text-xs text-muted-foreground">
            {approvedCount > 0 && rejectedCount === 0 ? "All approved" : "Review complete"}
          </span>
        )}
      </div>

      {/* File list */}
      <div className="divide-y divide-border/30">
        {changes.map((change, idx) => {
          const diff = computeDiff(change.oldContent, change.newContent);
          const added = diff.filter((d) => d.type === "added").length;
          const removed = diff.filter((d) => d.type === "removed").length;
          const isExpanded = expandedFiles.has(idx);
          const isPending = change.status === "pending";
          const isApproved = change.status === "approved" || change.status === "applied";
          const isRejected = change.status === "rejected";

          return (
            <div key={idx}>
              {/* File row */}
              <div className="flex items-center gap-2 px-4 py-2.5">
                <button
                  onClick={() => toggleFile(idx)}
                  className="flex h-5 w-5 items-center justify-center text-muted-foreground"
                >
                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {isApproved ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : isRejected ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <FileCode className="h-4 w-4 text-blue-500" />
                )}
                <span className="text-sm font-mono truncate flex-1">{change.path}</span>
                <span className="text-xs text-green-600 dark:text-green-500">+{added}</span>
                <span className="text-xs text-red-600 dark:text-red-500">-{removed}</span>
                {isPending && (
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => onRejectOne?.(idx)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                      title="Reject"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onApproveOne?.(idx)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-green-500/10 hover:text-green-500"
                      title="Approve"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Expanded diff */}
              {isExpanded && (
                <div className="border-t border-border/30 bg-[#1e1e2e]">
                  {/* Description */}
                  <div className="px-4 py-1.5 border-b border-white/5">
                    <p className="text-xs text-gray-400">{change.description}</p>
                  </div>
                  {/* View toggle */}
                  <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/5">
                    <button
                      onClick={() => setViewMode("diff")}
                      className={cn("rounded px-2 py-0.5 text-xs", viewMode === "diff" ? "bg-white/10 text-white" : "text-gray-500")}
                    >
                      Diff
                    </button>
                    <button
                      onClick={() => setViewMode("new")}
                      className={cn("rounded px-2 py-0.5 text-xs", viewMode === "new" ? "bg-white/10 text-white" : "text-gray-500")}
                    >
                      Full File
                    </button>
                  </div>
                  {/* Code */}
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    {viewMode === "diff" ? (
                      <DiffView diff={diff} />
                    ) : (
                      <pre className="selectable p-3 text-xs font-mono text-gray-200 whitespace-pre-wrap">
                        {change.newContent}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
