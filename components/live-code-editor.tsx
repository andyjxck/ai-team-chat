"use client";

import { useState, useEffect, useRef } from "react";
import { FileCode, Loader2, Check, X, RotateCcw, Terminal, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeDiff, type DiffLine } from "@/lib/diff";
import { Avatar } from "./avatar";

export type LiveCodeEdit = {
  repo: string;
  path: string;
  description: string;
  oldContent: string;
  newContent: string;
  agentName: string;
  agentAvatar: string;
  agentId: string;
  changeId?: string;
  status: "editing" | "done" | "accepted" | "rejected";
};

export function LiveCodeEditor({ edit, onAccept, onReject }: {
  edit: LiveCodeEdit;
  onAccept?: (edit: LiveCodeEdit) => void;
  onReject?: (edit: LiveCodeEdit) => void;
}) {
  const [phase, setPhase] = useState<"editing" | "diff" | "done">("editing");
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState(0);
  const [viewMode, setViewMode] = useState<"diff" | "new">("diff");
  const [expanded, setExpanded] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const newLines = edit.newContent.split("\n");
  const oldLines = edit.oldContent.split("\n");
  const diff = computeDiff(edit.oldContent, edit.newContent);
  const addedCount = diff.filter((d) => d.type === "added").length;
  const removedCount = diff.filter((d) => d.type === "removed").length;

  // Typing animation — reveal lines progressively
  useEffect(() => {
    if (edit.status === "done" || edit.status === "accepted" || edit.status === "rejected") {
      // Skip animation if already complete
      setDisplayedLines(newLines);
      setPhase("diff");
      return;
    }

    setPhase("editing");
    setDisplayedLines([]);
    setCurrentLine(0);

    // Animate revealing lines
    let line = 0;
    const linesPerTick = Math.max(1, Math.floor(newLines.length / 30)); // Finish in ~30 ticks
    timerRef.current = setInterval(() => {
      line += linesPerTick;
      if (line >= newLines.length) {
        line = newLines.length;
        setDisplayedLines(newLines);
        setPhase("diff");
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setDisplayedLines(newLines.slice(0, line));
        setCurrentLine(line);
      }
    }, 50);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [edit.path, edit.newContent, edit.status]);

  const isEditing = phase === "editing";
  const isComplete = edit.status === "accepted" || edit.status === "rejected";

  async function handleAccept() {
    if (edit.changeId) {
      const ts = parseInt(edit.changeId, 10);
      if (ts) {
        await fetch("/api/r2/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "accept", repo: edit.repo, path: edit.path, timestamp: ts }),
        });
      }
    }
    onAccept?.(edit);
  }

  async function handleReject() {
    if (edit.changeId) {
      const ts = parseInt(edit.changeId, 10);
      if (ts) {
        await fetch("/api/r2/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject", repo: edit.repo, path: edit.path, timestamp: ts }),
        });
      }
    }
    onReject?.(edit);
  }

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-all animate-scale-in",
      isEditing && "border-blue-500/40 bg-blue-500/5",
      edit.status === "accepted" && "border-green-500/40 bg-green-500/5",
      edit.status === "rejected" && "border-muted bg-muted/20 opacity-60",
      phase === "diff" && !isComplete && "border-blue-500/40",
    )}>
      {/* Header — agent info + file path */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-muted/30">
        <div className="flex items-center gap-2.5">
          <Avatar id={edit.agentId} name={edit.agentName} size="sm" />
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">{edit.agentName}</span>
            {isEditing && (
              <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                editing...
              </span>
            )}
            {phase === "diff" && !isComplete && (
              <span className="text-xs text-muted-foreground">finished editing</span>
            )}
            {edit.status === "accepted" && (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
                <Check className="h-3 w-3" /> accepted
              </span>
            )}
            {edit.status === "rejected" && (
              <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-500">
                <X className="h-3 w-3" /> rejected (undone)
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]">{edit.path}</span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* Description */}
          <div className="px-4 py-1.5 border-b border-border/30 bg-muted/10">
            <p className="text-xs text-muted-foreground">{edit.description}</p>
          </div>

          {/* Code view */}
          <div className="border-t border-border/30 bg-[#1e1e2e] max-h-[400px] overflow-y-auto">
            {isEditing ? (
              // Live typing view — shows lines being written
              <div className="font-mono text-xs">
                {displayedLines.map((line, i) => (
                  <div key={i} className="flex px-3 py-0.5 text-gray-300">
                    <span className="w-8 shrink-0 text-gray-600 select-none">{i + 1}</span>
                    <span className="selectable whitespace-pre-wrap break-all">{line}</span>
                  </div>
                ))}
                {/* Cursor line */}
                {currentLine < newLines.length && (
                  <div className="flex px-3 py-0.5">
                    <span className="w-8 shrink-0 text-gray-600 select-none">{currentLine + 1}</span>
                    <span className="inline-block h-3.5 w-2 animate-pulse bg-blue-400" />
                  </div>
                )}
              </div>
            ) : viewMode === "diff" ? (
              <DiffView diff={diff} />
            ) : (
              <pre className="selectable p-3 text-xs font-mono text-gray-200 whitespace-pre-wrap">
                {edit.newContent}
              </pre>
            )}
          </div>

          {/* Footer — diff stats + actions */}
          {phase === "diff" && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/20">
              <div className="flex items-center gap-3">
                {viewMode === "diff" ? (
                  <>
                    <span className="text-xs text-green-600 dark:text-green-500">+{addedCount}</span>
                    <span className="text-xs text-red-600 dark:text-red-500">-{removedCount}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">{newLines.length} lines</span>
                )}
                <div className="flex gap-1">
                  <button
                    onClick={() => setViewMode("diff")}
                    className={cn("rounded px-2 py-0.5 text-xs", viewMode === "diff" ? "bg-accent" : "text-muted-foreground")}
                  >
                    Diff
                  </button>
                  <button
                    onClick={() => setViewMode("new")}
                    className={cn("rounded px-2 py-0.5 text-xs", viewMode === "new" ? "bg-accent" : "text-muted-foreground")}
                  >
                    Full
                  </button>
                </div>
              </div>
              {!isComplete && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleReject()}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject (Undo)
                  </button>
                  <button
                    onClick={() => handleAccept()}
                    className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Accept
                  </button>
                </div>
              )}
            </div>
          )}
        </>
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
          <span className="w-8 shrink-0 text-gray-600 select-none">{line.oldLine ?? ""}</span>
          <span className="w-8 shrink-0 text-gray-600 select-none">{line.newLine ?? ""}</span>
          <span className="w-4 shrink-0 select-none">
            {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
          </span>
          <span className="selectable whitespace-pre-wrap break-all">{line.content}</span>
        </div>
      ))}
    </div>
  );
}
