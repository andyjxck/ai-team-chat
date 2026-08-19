"use client";

import { cn, formatTime } from "@/lib/utils";
import { ToolCallCard } from "./tool-call-card";
import { Reply, Check, CheckCheck } from "lucide-react";
import { Avatar } from "./avatar";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClientMessage } from "@/db/client-types";

export function MessageBubble({
  message,
  onReply,
  grouped,
}: {
  message: ClientMessage;
  onReply?: (msg: ClientMessage) => void;
  grouped?: "first" | "continued";
}) {
  const isHuman = message.senderType === "human";
  const agent = message.agent;
  const name = isHuman ? "You" : agent?.name ?? "Agent";
  const role = isHuman ? "" : agent?.role ?? "";
  const isContinued = grouped === "continued";

  return (
    <div className={cn(
      "group flex gap-3",
      isHuman ? "flex-row-reverse" : "",
      !isContinued && (isHuman ? "msg-enter-human" : "msg-enter"),
    )}>
      {/* Avatar — hidden on continued messages, show spacer instead */}
      {isContinued ? (
        <div className="w-8 shrink-0" />
      ) : isHuman ? (
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

        {/* Name + time + status — hidden on continued messages */}
        {!isContinued && (
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
        )}

        {/* Bubble */}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm transition-all",
            isHuman
              ? cn("bg-primary text-primary-foreground", isContinued ? "rounded-tr-md" : "rounded-tr-md")
              : "bg-card border border-border/50 hover:border-border hover:shadow-md",
            isContinued && (isHuman ? "rounded-tr-md" : "rounded-tl-md"),
          )}
        >
          <div className="selectable break-words [&_p]:my-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:my-2 [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#0d1117] [&_pre]:p-3 [&_pre_code]:text-gray-200 [&_a]:text-primary [&_a]:underline [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-sm [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.filter(tc => !["draft_action", "ask_question"].includes(tc.tool)).length > 0 && (
          <div className="space-y-1.5">
            {message.toolCalls.filter(tc => !["draft_action", "ask_question"].includes(tc.tool)).map((tc, i) => (
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
