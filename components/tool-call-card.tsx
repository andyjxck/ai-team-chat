"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCallRecord } from "@/db/client-types";

const TOOL_ICONS: Record<string, string> = {
  serper_search: "🔍",
  web_fetch: "🌐",
  code_edit: "✏️",
  code_review: "🔎",
  r2_read_file: "📄",
  r2_list_files: "📁",
  r2_list_repos: "🗂️",
  r2_upload_file: "📤",
  r2_search_files: "🔎",
  netlify_deploy: "🚀",
  netlify_list_deploys: "📋",
  image_gen: "🎨",
  social_post_x: "🐦",
  gmail_send: "📧",
  gmail_search: "📧",
  gmail_read: "📧",
  calendar_create: "📅",
  calendar_list: "📅",
  memory_save: "💾",
  memory_load: "💾",
  draft_action: "📝",
  ask_question: "❓",
  proactive_message: "💬",
};

const TOOL_LABELS: Record<string, string> = {
  serper_search: "Web Search",
  web_fetch: "Fetch URL",
  code_edit: "Edit File",
  code_review: "Review Code",
  r2_read_file: "Read File",
  r2_list_files: "List Files",
  r2_list_repos: "List Repos",
  r2_upload_file: "Upload File",
  r2_search_files: "Search Files",
  netlify_deploy: "Deploy to Netlify",
  netlify_list_deploys: "List Deploys",
  image_gen: "Generate Image",
  social_post_x: "Post to X",
  gmail_send: "Send Email",
  gmail_search: "Search Email",
  gmail_read: "Read Email",
  calendar_create: "Create Event",
  calendar_list: "List Events",
  memory_save: "Save Memory",
  memory_load: "Load Memory",
  draft_action: "Draft Preview",
  ask_question: "Ask Question",
  proactive_message: "Proactive Message",
};

export function ToolCallCard({ toolCall }: { toolCall: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = toolCall.result !== undefined;
  const hasError = !!toolCall.error;
  const isLoading = !hasResult && !hasError;

  const icon = TOOL_ICONS[toolCall.tool] ?? "🔧";
  const label = TOOL_LABELS[toolCall.tool] ?? toolCall.tool;

  return (
    <div className={cn(
      "rounded-xl border text-xs transition-all animate-fade-in",
      hasError
        ? "border-destructive/30 bg-destructive/5"
        : hasResult
          ? "border-border bg-card/50"
          : "border-primary/30 bg-primary/5",
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm">{icon}</span>
        <span className="font-medium">{label}</span>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
        {hasResult && !hasError && (
          <CheckCircle className="h-3 w-3 text-green-500" />
        )}
        {hasError && <XCircle className="h-3 w-3 text-destructive" />}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border/50 px-3 py-2 animate-fade-in">
          {Object.keys(toolCall.args as object).length > 0 && (
            <div>
              <span className="text-muted-foreground font-medium">Input:</span>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/50 p-2 text-xs font-mono">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {hasResult && (
            <div>
              <span className="text-muted-foreground font-medium">Result:</span>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/50 p-2 text-xs font-mono max-h-48">
                {typeof toolCall.result === "string"
                  ? toolCall.result.slice(0, 2000)
                  : JSON.stringify(toolCall.result, null, 2).slice(0, 2000)}
              </pre>
            </div>
          )}
          {hasError && (
            <div>
              <span className="text-destructive font-medium">Error:</span>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
