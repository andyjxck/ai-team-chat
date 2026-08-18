"use client";

import { cn, formatTime } from "@/lib/utils";
import { ToolCallCard } from "./tool-call-card";
import type { ClientMessage } from "./chat-view";

export function MessageBubble({ message }: { message: ClientMessage }) {
  const isHuman = message.senderType === "human";
  const agent = message.agent;
  const avatar = isHuman ? "🧑" : agent?.avatar ?? "🤖";
  const name = isHuman ? "You" : agent?.name ?? "Agent";
  const role = isHuman ? "" : agent?.role ?? "";

  return (
    <div className={cn("flex gap-3", isHuman && "flex-row-reverse")}>
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-base">
        {avatar}
      </div>

      {/* Message content */}
      <div className={cn("flex max-w-[80%] flex-col gap-1", isHuman && "items-end")}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{name}</span>
          {role && <span className="text-xs text-muted-foreground">{role}</span>}
          <span className="text-xs text-muted-foreground">
            {formatTime(Math.floor(new Date(message.createdAt).getTime() / 1000))}
          </span>
          {message.streaming && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              typing
            </span>
          )}
        </div>

        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            isHuman
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground",
          )}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-1">
            {message.toolCalls.map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
