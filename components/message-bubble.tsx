"use client";

import { cn, formatTime } from "@/lib/utils";
import { ToolCallCard } from "./tool-call-card";
import { Reply, Check, CheckCheck } from "lucide-react";
import { Avatar } from "./avatar";
import type { ClientMessage } from "@/db/client-types";

export function MessageBubble({
  message,
  onReply,
}: {
  message: ClientMessage;
  onReply?: (msg: ClientMessage) => void;
}) {
  const isHuman = message.senderType === "human";
  const agent = message.agent;
  const name = isHuman ? "You" : agent?.name ?? "Agent";
  const role = isHuman ? "" : agent?.role ?? "";

  return (
    <div className={cn(
      "group flex gap-3 animate-fade-in",
      isHuman ? "flex-row-reverse msg-enter-human" : "msg-enter",
    )}>
      {/* Avatar */}
      {isHuman ? (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white shadow-md">
          A
        </div>
      ) : (
        <div className="relative">
          <Avatar
            id={agent?.id ?? "default"}
            emoji={agent?.avatar}
            name={agent?.name ?? "Agent"}
            size="sm"
          />
          <span className="online-indicator absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background" />
        </div>
      )}

      {/* Message content */}
      <div className={cn("flex max-w-[78%] flex-col gap-1", isHuman && "items-end")}>
        {/* Reply context */}
        {message.replyTo && (
          <div className={cn(
            "flex items-center gap-1.5 rounded-lg border-l-2 border-primary/50 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground",
            isHuman && "flex-row-reverse border-l-0 border-r-2",
          )}>
            <Reply className="h-3 w-3 shrink-0" />
            <span className="font-medium">{message.replyTo.senderName}</span>
            <span className="truncate max-w-[180px]">{message.replyTo.content}</span>
          </div>
        )}

        {/* Name + time + status */}
        <div className={cn("flex items-center gap-2", isHuman && "flex-row-reverse")}>
          <span className="text-sm font-semibold">{name}</span>
          {role && <span className="text-xs text-muted-foreground/80">{role}</span>}
          <span className="text-xs text-muted-foreground/60">
            {formatTime(Math.floor(new Date(message.createdAt).getTime() / 1000))}
          </span>
          {isHuman && !message.streaming && (
            <CheckCheck className="h-3.5 w-3.5 text-blue-500" />
          )}
          {message.streaming && (
            <span className="flex items-center gap-0.5">
              <span className="typing-dot h-1 w-1 rounded-full bg-primary" />
              <span className="typing-dot h-1 w-1 rounded-full bg-primary" />
              <span className="typing-dot h-1 w-1 rounded-full bg-primary" />
            </span>
          )}
        </div>

        {/* Bubble */}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm transition-all",
            isHuman
              ? "rounded-tr-md bg-primary text-primary-foreground"
              : "rounded-tl-md bg-card border border-border/50 hover:border-border hover:shadow-md",
          )}
        >
          <p className="selectable whitespace-pre-wrap break-words">{message.content}</p>
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.filter(tc => !["draft_action", "ask_question", "code_edit", "code_review"].includes(tc.tool)).length > 0 && (
          <div className="space-y-1.5">
            {message.toolCalls.filter(tc => !["draft_action", "ask_question", "code_edit", "code_review"].includes(tc.tool)).map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Reply button — appears on hover */}
        {!message.streaming && (
          <button
            onClick={() => onReply?.(message)}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 transition-all hover:bg-accent group-hover:opacity-100",
              isHuman && "flex-row-reverse",
            )}
            title="Reply"
          >
            <Reply className="h-3 w-3" />
            Reply
          </button>
        )}
      </div>
    </div>
  );
}
