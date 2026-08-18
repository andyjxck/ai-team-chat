"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Agent } from "@/db/schema";

export function MessageInput({
  onSend,
  onStop,
  isStreaming,
  members,
  chatType,
  routingMode,
}: {
  onSend: (text: string, mentions: string[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  members: Agent[];
  chatType: string;
  routingMode: string;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed, mentions);
    setText("");
    setMentions([]);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);

    // Detect @mention
    const cursorPos = e.target.selectionStart;
    const beforeCursor = value.slice(0, cursorPos);
    const atMatch = beforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setShowMentions(true);
      setMentionQuery(atMatch[1].toLowerCase());
    } else {
      setShowMentions(false);
    }
  }

  function selectMention(agent: Agent) {
    // Replace the @query with @name
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const replaced = before.replace(/@(\w*)$/, `@${agent.name} `);
    setText(replaced + after);
    setMentions((prev) =>
      prev.includes(agent.id) ? prev : [...prev, agent.id],
    );
    setShowMentions(false);
    textareaRef.current?.focus();
  }

  const filteredMembers = members.filter((m) =>
    m.name.toLowerCase().startsWith(mentionQuery),
  );

  const placeholder =
    chatType === "dm"
      ? `Message ${members[0]?.name ?? ""}...`
      : routingMode === "mentioned_only"
        ? "Message the team... (use @ to mention someone)"
        : "Message the team...";

  return (
    <div
      className="relative border-t border-border p-3 md:p-4"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      {/* Mention dropdown */}
      {showMentions && filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-48 rounded-md border border-border bg-popover bg-card shadow-lg">
          {filteredMembers.map((agent) => (
            <button
              key={agent.id}
              onClick={() => selectMention(agent)}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
            >
              <span>{agent.avatar}</span>
              <span>{agent.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {agent.role}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none ring-ring focus:ring-2 md:text-sm"
          />
        </div>
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9 md:w-9"
            title="Stop"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 md:h-9 md:w-9"
            title="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Mentioned agents indicator */}
      {mentions.length > 0 && (
        <div className="mx-auto mt-1 flex max-w-3xl flex-wrap gap-1">
          {mentions.map((id) => {
            const agent = members.find((m) => m.id === id);
            if (!agent) return null;
            return (
              <span
                key={id}
                className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
              >
                <AtSign className="h-3 w-3" />
                {agent.name}
                <button
                  onClick={() =>
                    setMentions((prev) => prev.filter((m) => m !== id))
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
