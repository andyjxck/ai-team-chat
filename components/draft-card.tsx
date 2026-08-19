"use client";

import { useState, useEffect } from "react";
import { Check, X, ChevronDown, ChevronUp, Loader2, Edit3, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraftData } from "@/db/client-types";

const typeIcons: Record<DraftData["type"], string> = {
  social_post: "📱",
  email: "📧",
  calendar_event: "📅",
  file_write: "📄",
  code_run: "💻",
  other: "📋",
};

const typeLabels: Record<DraftData["type"], string> = {
  social_post: "Social Post",
  email: "Email",
  calendar_event: "Calendar Event",
  file_write: "File",
  code_run: "Code",
  other: "Action",
};

const typeFields: Record<DraftData["type"], { key: string; label: string; editable: boolean; multiline?: boolean }[]> = {
  social_post: [
    { key: "text", label: "Post Content", editable: true, multiline: true },
    { key: "platform", label: "Platform", editable: false },
  ],
  email: [
    { key: "to", label: "To", editable: true },
    { key: "subject", label: "Subject", editable: true },
    { key: "body", label: "Body", editable: true, multiline: true },
  ],
  calendar_event: [
    { key: "title", label: "Title", editable: true },
    { key: "start", label: "Start", editable: true },
    { key: "end", label: "End", editable: true },
    { key: "description", label: "Description", editable: true, multiline: true },
  ],
  file_write: [
    { key: "path", label: "File Path", editable: true },
    { key: "content", label: "Content", editable: true, multiline: true },
  ],
  code_run: [
    { key: "language", label: "Language", editable: true },
    { key: "code", label: "Code", editable: true, multiline: true },
  ],
  other: [
    { key: "content", label: "Content", editable: true, multiline: true },
  ],
};

export function DraftCard({
  draft,
  chatId,
  onUpdate,
}: {
  draft: DraftData;
  chatId: string;
  onUpdate: (draft: DraftData) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedData, setEditedData] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setEditedData({ ...draft.actionData });
  }, [draft.actionData]);

  async function approve() {
    setLoading(true);
    onUpdate({ ...draft, status: "executing" });
    try {
      const dataToSend = editing ? editedData : draft.actionData;
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: draft.actionType,
          actionData: dataToSend,
          chatId,
          agentId: draft.agentId,
        }),
      });
      const data = await res.json();
      if (data.error) {
        onUpdate({ ...draft, status: "error", error: data.error });
      } else {
        onUpdate({ ...draft, status: "done", result: data.result });
      }
    } catch (err) {
      onUpdate({
        ...draft,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to execute",
      });
    } finally {
      setLoading(false);
    }
  }

  function reject() {
    onUpdate({ ...draft, status: "rejected" });
  }

  function saveEdit() {
    onUpdate({
      ...draft,
      actionData: { ...draft.actionData, ...editedData },
      preview: buildPreview(draft.type, editedData),
    });
    setEditing(false);
  }

  const isPending = draft.status === "pending_approval";
  const isExecuting = draft.status === "executing" || loading;
  const isDone = draft.status === "done";
  const isRejected = draft.status === "rejected";
  const isError = draft.status === "error";

  const fields = typeFields[draft.type] ?? typeFields.other;

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition-all animate-scale-in",
        isPending && "border-blue-500/40 bg-blue-500/5",
        isDone && "border-green-500/40 bg-green-500/5",
        isRejected && "border-muted bg-muted/20 opacity-60",
        isError && "border-red-500/40 bg-red-500/5",
        isExecuting && "border-yellow-500/40 bg-yellow-500/5",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{typeIcons[draft.type]}</span>
          <div>
            <span className="text-sm font-semibold">{draft.title}</span>
            <span className="ml-2 text-xs text-muted-foreground">{typeLabels[draft.type]}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isPending && (
            <>
              {editing ? (
                <button
                  onClick={saveEdit}
                  className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/80"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </button>
              ) : (
                <button
                  onClick={() => setEditing(!editing)}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit
                </button>
              )}
              <button
                onClick={reject}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </button>
              <button
                onClick={approve}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Check className="h-3.5 w-3.5" />
                Approve & Send
              </button>
            </>
          )}
          {isExecuting && (
            <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Executing...
            </span>
          )}
          {isDone && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-500">
              <Check className="h-3.5 w-3.5" />
              Sent
            </span>
          )}
          {isRejected && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <X className="h-3.5 w-3.5" />
              Rejected
            </span>
          )}
          {isError && (
            <span className="text-xs font-medium text-red-600 dark:text-red-500">Error</span>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Preview content */}
      {expanded && (
        <div className="border-t border-border/50">
          {editing ? (
            // Edit mode — show editable fields
            <div className="space-y-3 p-4">
              {fields.map((field) => (
                <div key={field.key}>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {field.label}
                  </label>
                  {field.multiline ? (
                    <textarea
                      value={String(editedData[field.key] ?? "")}
                      onChange={(e) => setEditedData({ ...editedData, [field.key]: e.target.value })}
                      rows={6}
                      className="selectable w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
                    />
                  ) : (
                    <input
                      value={String(editedData[field.key] ?? "")}
                      onChange={(e) => setEditedData({ ...editedData, [field.key]: e.target.value })}
                      className="selectable w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            // View mode — show formatted preview
            <div className="p-4">
              <PreviewContent type={draft.type} data={draft.actionData} preview={draft.preview} />
            </div>
          )}

          {isError && draft.error && (
            <div className="border-t border-border/50 px-4 py-2">
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-500">
                {draft.error}
              </p>
            </div>
          )}
          {isDone && draft.result ? (() => {
            const r = draft.result as Record<string, unknown>;
            const successMsg = formatSuccessMessage(draft.type, r);
            return (
              <div className="border-t border-border/50 px-4 py-2">
                <div className="flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-400">
                  <Check className="h-4 w-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              </div>
            );
          })() : null}
        </div>
      )}
    </div>
  );
}

function buildPreview(type: DraftData["type"], data: Record<string, unknown>): string {
  switch (type) {
    case "email":
      return `To: ${data.to}\nSubject: ${data.subject}\n\n${data.body}`;
    case "social_post":
      return `${data.text}`;
    case "calendar_event":
      return `${data.title}\n${data.start} - ${data.end}\n${data.description ?? ""}`;
    default:
      return JSON.stringify(data, null, 2);
  }
}

function PreviewContent({
  type,
  data,
  preview,
}: {
  type: DraftData["type"];
  data: Record<string, unknown>;
  preview: string;
}) {
  switch (type) {
    case "email":
      return (
        <div className="rounded-lg border border-border/50 bg-background">
          <div className="border-b border-border/50 px-4 py-2.5">
            <div className="flex gap-2 text-xs">
              <span className="font-medium text-muted-foreground">To:</span>
              <span className="selectable">{String(data.to ?? "")}</span>
            </div>
            <div className="flex gap-2 text-xs">
              <span className="font-medium text-muted-foreground">Subject:</span>
              <span className="selectable font-medium">{String(data.subject ?? "")}</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="selectable whitespace-pre-wrap break-words text-sm">
              {String(data.body ?? "")}
            </p>
          </div>
        </div>
      );

    case "social_post":
      return (
        <div className="rounded-lg border border-border/50 bg-background p-4">
          <p className="selectable whitespace-pre-wrap break-words text-sm">
            {String(data.text ?? preview)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Platform: {String(data.platform ?? "x")}
          </p>
        </div>
      );

    case "calendar_event":
      return (
        <div className="rounded-lg border border-border/50 bg-background p-4 space-y-2">
          <p className="selectable text-sm font-semibold">{String(data.title ?? "")}</p>
          <p className="selectable text-xs text-muted-foreground">
            {String(data.start ?? "")} — {String(data.end ?? "")}
          </p>
          {data.description ? (
            <p className="selectable whitespace-pre-wrap break-words text-sm">
              {String(data.description)}
            </p>
          ) : null}
        </div>
      );

    default:
      return (
        <pre className="selectable whitespace-pre-wrap break-words text-sm rounded-lg border border-border/50 bg-background p-4">
          {preview}
        </pre>
      );
  }
}

function formatSuccessMessage(type: DraftData["type"], result: Record<string, unknown>): string {
  if (!result.success && result.error) return String(result.error);

  switch (type) {
    case "email":
      return `Email sent successfully to ${result.to ?? "recipient"}.`;
    case "social_post":
      return result.url ? `Posted successfully: ${result.url}` : "Post published successfully.";
    case "calendar_event":
      return `Calendar event "${result.title ?? result.summary ?? "event"}" created successfully.`;
    case "file_write":
      return `File saved: ${result.path ?? "file"}`;
    case "code_run":
      return "Code executed successfully.";
    default:
      return result.message ? String(result.message) : "Action completed successfully.";
  }
}
