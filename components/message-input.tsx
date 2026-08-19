"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square, AtSign, X, Reply, Paperclip, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientAgent as Agent, ClientMessage } from "@/db/client-types";
import { Avatar } from "./avatar";

export function MessageInput({
  onSend,
  onStop,
  isStreaming,
  members,
  chatType,
  routingMode,
  replyTo,
  onCancelReply,
}: {
  onSend: (text: string, mentions: string[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  members: Agent[];
  chatType: string;
  routingMode: string;
  replyTo?: ClientMessage | null;
  onCancelReply?: () => void;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
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
    if (!trimmed) return;
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
        ? "Message the team... (use @ to mention)"
        : "Message the team...";

  return (
    <div
      className="relative border-t border-border/50 bg-background/80 backdrop-blur-md p-3 md:p-4"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      {/* Reply-to bar */}
      {replyTo && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-2 text-xs animate-fade-in">
          <Reply className="h-3 w-3 shrink-0 text-primary" />
          <span className="font-medium">{replyTo.agent?.name ?? "You"}</span>
          <span className="truncate text-muted-foreground">{replyTo.content.slice(0, 100)}</span>
          <button
            onClick={onCancelReply}
            className="ml-auto shrink-0 rounded p-0.5 hover:bg-accent"
            title="Cancel reply"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Mention dropdown — sleek */}
      {showMentions && filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-scale-in">
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50">
            Mention someone
          </p>
          {filteredMembers.map((agent) => (
            <button
              key={agent.id}
              onClick={() => selectMention(agent)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-accent transition-colors"
            >
              <Avatar id={agent.id} emoji={agent.avatar} name={agent.name} size="xs" />
              <div className="text-left">
                <span className="block font-medium">{agent.name}</span>
                <span className="block text-xs text-muted-foreground">{agent.role}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mx-auto flex max-w-3xl items-end gap-2">
        {/* Attach button (placeholder for future file uploads) */}
        <button
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-muted-foreground transition-all hover:bg-accent hover:text-foreground md:h-10 md:w-10"
          title="Attach file"
          onClick={() => {/* TODO: file upload */}}
        >
          <Paperclip className="h-5 w-5" />
        </button>

        {/* Input container with focus glow */}
        <div className={cn(
          "relative flex-1 transition-all",
          isFocused && "ring-2 ring-primary/20 rounded-2xl",
        )}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-base outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary/50 md:text-sm"
          />
        </div>

        {/* Send button + Stop button */}
        <div className="flex shrink-0 items-center gap-1">
          {isStreaming && (
            <button
              onClick={onStop}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-destructive text-destructive-foreground shadow-lg transition-all hover:bg-destructive/90 hover:scale-105 md:h-10 md:w-10"
              title="Stop"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white transition-all md:h-10 md:w-10",
              text.trim()
                ? "bg-primary shadow-lg shadow-primary/20 hover:scale-105 hover:bg-primary/90"
                : "bg-muted text-muted-foreground",
            )}
            title="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mentioned agents + hint */}
      <div className="mx-auto mt-1.5 flex max-w-3xl items-center gap-2">
        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {mentions.map((id) => {
              const agent = members.find((m) => m.id === id);
              if (!agent) return null;
              return (
                <span
                  key={id}
                  className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  <AtSign className="h-3 w-3" />
                  {agent.name}
                  <button
                    onClick={() => setMentions((prev) => prev.filter((m) => m !== id))}
                    className="text-primary/60 hover:text-primary"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {!text && mentions.length === 0 && !isStreaming && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground/40">
            <Sparkles className="h-3 w-3" />
            Press Enter to send · Shift+Enter for new line
          </p>
        )}
      </div>
    </div>
  );
}
