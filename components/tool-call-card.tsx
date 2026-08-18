"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCallRecord } from "@/db/schema";

export function ToolCallCard({ toolCall }: { toolCall: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = toolCall.result !== undefined;
  const hasError = !!toolCall.error;

  return (
    <div className="rounded-md border border-border bg-secondary/50 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium">{toolCall.tool}</span>
        {hasResult && !hasError && (
          <CheckCircle className="h-3 w-3 text-green-500" />
        )}
        {hasError && <XCircle className="h-3 w-3 text-destructive" />}
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-border px-2 py-1.5">
          <div>
            <span className="text-muted-foreground">args:</span>
            <pre className={cn("mt-0.5 overflow-x-auto rounded bg-background/50 p-1 text-xs")}>
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {hasResult && (
            <div>
              <span className="text-muted-foreground">result:</span>
              <pre className="mt-0.5 overflow-x-auto rounded bg-background/50 p-1 text-xs">
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {hasError && (
            <div>
              <span className="text-destructive">error:</span>
              <pre className="mt-0.5 overflow-x-auto rounded bg-background/50 p-1 text-xs text-destructive">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
