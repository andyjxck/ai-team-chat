"use client";

import { useState } from "react";
import {
  ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2,
  FileCode, Search, Globe, Image, Mail, Calendar, Database,
  GitBranch, GitCommit, Trash2, Eye, Send, Bell, MessageSquare,
  HelpCircle, Sparkles, Zap, ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCallRecord } from "@/db/client-types";

type ToolMeta = { icon: React.ComponentType<{ className?: string }>; label: string; accent: string };

const TOOL_META: Record<string, ToolMeta> = {
  github_read_file: { icon: FileCode, label: "Read File", accent: "blue" },
  github_list_files: { icon: FileCode, label: "Browse Files", accent: "blue" },
  github_list_repos: { icon: Database, label: "List Repos", accent: "blue" },
  github_edit_file: { icon: GitCommit, label: "Edit File", accent: "green" },
  github_delete_file: { icon: Trash2, label: "Delete File", accent: "red" },
  github_review: { icon: Eye, label: "Review Code", accent: "purple" },
  github_get_commits: { icon: GitBranch, label: "Git History", accent: "blue" },
  github_create_branch: { icon: GitBranch, label: "Create Branch", accent: "blue" },
  github_create_pr: { icon: GitBranch, label: "Create PR", accent: "green" },
  github_create_issue: { icon: MessageSquare, label: "Create Issue", accent: "yellow" },
  github_search_code: { icon: Search, label: "Search Code", accent: "blue" },
  github_list_branches: { icon: GitBranch, label: "List Branches", accent: "blue" },
  netlify_list_deploys: { icon: Zap, label: "Deploy Status", accent: "orange" },
  serper_search: { icon: Search, label: "Web Search", accent: "cyan" },
  web_fetch: { icon: Globe, label: "Fetch URL", accent: "cyan" },
  image_gen: { icon: Image, label: "Generate Image", accent: "pink" },
  social_post_x: { icon: Send, label: "Post to X", accent: "sky" },
  gmail_send: { icon: Mail, label: "Send Email", accent: "red" },
  gmail_search: { icon: Search, label: "Search Email", accent: "red" },
  gmail_read: { icon: Mail, label: "Read Email", accent: "red" },
  calendar_create: { icon: Calendar, label: "Create Event", accent: "orange" },
  calendar_list: { icon: Calendar, label: "List Events", accent: "orange" },
  calendar_update: { icon: Calendar, label: "Update Event", accent: "orange" },
  calendar_delete: { icon: Calendar, label: "Delete Event", accent: "red" },
  memory_save: { icon: Sparkles, label: "Save Memory", accent: "purple" },
  leads_create: { icon: Zap, label: "Create Lead", accent: "yellow" },
  leads_update: { icon: Zap, label: "Update Lead", accent: "yellow" },
  leads_list: { icon: Database, label: "List Leads", accent: "yellow" },
  contacts_create: { icon: MessageSquare, label: "Create Contact", accent: "blue" },
  contacts_search: { icon: Search, label: "Search Contacts", accent: "blue" },
  reminder_create: { icon: Bell, label: "Create Reminder", accent: "orange" },
  reminder_list: { icon: Bell, label: "List Reminders", accent: "orange" },
  draft_action: { icon: FileCode, label: "Draft", accent: "slate" },
  ask_question: { icon: HelpCircle, label: "Ask Question", accent: "blue" },
  proactive_message: { icon: Send, label: "Proactive Message", accent: "cyan" },
  message_agent: { icon: MessageSquare, label: "Message Agent", accent: "cyan" },
};

const DEFAULT_META: ToolMeta = { icon: Zap, label: "Tool Call", accent: "slate" };

const ACCENT_BG: Record<string, string> = {
  blue: "bg-blue-500/10 border-blue-500/20", green: "bg-green-500/10 border-green-500/20",
  red: "bg-red-500/10 border-red-500/20", orange: "bg-orange-500/10 border-orange-500/20",
  purple: "bg-purple-500/10 border-purple-500/20", cyan: "bg-cyan-500/10 border-cyan-500/20",
  pink: "bg-pink-500/10 border-pink-500/20", yellow: "bg-yellow-500/10 border-yellow-500/20",
  sky: "bg-sky-500/10 border-sky-500/20", slate: "bg-slate-500/10 border-slate-500/20",
};

const ACCENT_ICON: Record<string, string> = {
  blue: "text-blue-400", green: "text-green-400", red: "text-red-400",
  orange: "text-orange-400", purple: "text-purple-400", cyan: "text-cyan-400",
  pink: "text-pink-400", yellow: "text-yellow-400", sky: "text-sky-400", slate: "text-slate-400",
};

function getArgSummary(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "github_edit_file": case "github_read_file": case "github_delete_file": return String(args.path ?? "");
    case "github_list_files": return args.path ? String(args.path) : "root";
    case "github_create_branch": return String(args.branch ?? "");
    case "github_create_pr": case "github_create_issue": return String(args.title ?? "");
    case "github_search_code": case "serper_search": case "gmail_search": return String(args.query ?? "");
    case "web_fetch": return String(args.url ?? "");
    case "image_gen": return String(args.prompt ?? "").slice(0, 60);
    case "social_post_x": case "proactive_message": return String(args.message ?? args.content ?? "").slice(0, 60);
    case "gmail_send": return String(args.to ?? "");
    case "calendar_create": return String(args.title ?? "");
    case "memory_save": return String(args.key ?? "");
    case "leads_create": return String(args.name ?? "");
    case "reminder_create": return String(args.title ?? "");
    default: return "";
  }
}

function getDiffStats(result: unknown): { added: number; removed: number; isNew: boolean } | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.oldLineCount === "number" && typeof r.newLineCount === "number") {
    return { added: r.newLineCount as number, removed: r.oldLineCount as number, isNew: r.isNew === true };
  }
  return null;
}

function getLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", json: "json", css: "css", md: "markdown", html: "html", py: "python", yml: "yaml", yaml: "yaml", toml: "toml" };
  return map[ext ?? ""] ?? "text";
}

export function ToolCallCard({ toolCall }: { toolCall: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = toolCall.result !== undefined;
  const hasError = !!toolCall.error;
  const isLoading = !hasResult && !hasError;
  const meta = TOOL_META[toolCall.tool] ?? DEFAULT_META;
  const Icon = meta.icon;
  const summary = getArgSummary(toolCall.tool, toolCall.args);
  const diffStats = hasResult && !hasError ? getDiffStats(toolCall.result) : null;
  const codePreview = typeof toolCall.args.content === "string" ? toolCall.args.content : null;
  const isEdit = toolCall.tool === "github_edit_file";
  const commitUrl = hasResult && !hasError ? (toolCall.result as Record<string, unknown>)?.commitUrl as string | undefined : undefined;

  return (
    <div className={cn("group rounded-xl border transition-all animate-fade-in overflow-hidden", hasError ? "border-red-500/20 bg-red-500/[0.03]" : "border-white/10 bg-white/[0.02]")}>
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/30" />}
        <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", ACCENT_BG[meta.accent] ?? ACCENT_BG.slate)}>
          <Icon className={cn("h-3.5 w-3.5", ACCENT_ICON[meta.accent] ?? ACCENT_ICON.slate)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white/90">{meta.label}</span>
            {summary && <span className="truncate text-xs text-white/40 font-mono">{summary}</span>}
          </div>
        </div>
        {isLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/40" />}
        {hasResult && !hasError && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />}
        {hasError && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
        {diffStats && isEdit && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-mono font-semibold">
            {diffStats.isNew ? <span className="text-green-400">+{diffStats.added} new</span> : <>
              <span className="text-green-400">+{diffStats.added}</span><span className="text-white/20">/</span><span className="text-red-400">-{diffStats.removed}</span>
            </>}
          </div>
        )}
        {commitUrl && (
          <a href={commitUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-mono text-white/50 hover:text-white/90 hover:bg-white/10 transition-colors">
            commit<ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </button>
      {expanded && (
        <div className="border-t border-white/5 animate-fade-in">
          {isEdit && codePreview && (
            <div className="border-b border-white/5">
              <div className="px-3 py-1.5 bg-white/[0.02]">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{diffStats?.isNew ? "New file" : "Updated content"} · {getLang(summary)} · {codePreview.split("\n").length} lines</span>
              </div>
              <pre className="overflow-x-auto px-3 py-2 text-[11px] font-mono leading-relaxed text-white/70 max-h-64 overflow-y-auto">
                <code>{codePreview.slice(0, 5000)}{codePreview.length > 5000 ? "\n... (truncated)" : ""}</code>
              </pre>
            </div>
          )}
          {!isEdit && Object.keys(toolCall.args as object).length > 0 && (
            <div className="border-b border-white/5">
              <div className="px-3 py-1.5 bg-white/[0.02]"><span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">Input</span></div>
              <pre className="overflow-x-auto px-3 py-2 text-[11px] font-mono leading-relaxed text-white/60 max-h-40 overflow-y-auto">{JSON.stringify(toolCall.args, null, 2).slice(0, 3000)}</pre>
            </div>
          )}
          {hasResult && !hasError && (
            <div>
              <div className="px-3 py-1.5 bg-white/[0.02]"><span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">Result</span></div>
              <pre className="overflow-x-auto px-3 py-2 text-[11px] font-mono leading-relaxed text-white/60 max-h-48 overflow-y-auto">{typeof toolCall.result === "string" ? toolCall.result.slice(0, 3000) : JSON.stringify(toolCall.result, null, 2).slice(0, 3000)}</pre>
            </div>
          )}
          {hasError && (
            <div>
              <div className="px-3 py-1.5 bg-red-500/[0.05]"><span className="text-[10px] font-semibold uppercase tracking-wider text-red-400/70">Error</span></div>
              <pre className="overflow-x-auto px-3 py-2 text-[11px] font-mono leading-relaxed text-red-400/80 max-h-32 overflow-y-auto">{toolCall.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
