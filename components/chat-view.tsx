"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import type { Message, Agent, Chat, ToolCallRecord } from "@/db/schema";

export type StreamingEvent =
  | { type: "agent_start"; agentId: string }
  | { type: "token"; agentId: string; text: string }
  | { type: "tool_call"; agentId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; agentId: string; tool: string; result: unknown; error?: string }
  | { type: "message_end"; agentId: string; messageId: string; content: string }
  | { type: "error"; message: string };

export type ClientMessage = Omit<Message, "parentMessageId" | "mentions" | "toolCalls"> & {
  parentMessageId?: string | null;
  mentions?: string[];
  toolCalls?: ToolCallRecord[];
  streaming?: boolean;
  agent?: Agent | null;
};

const SYSTEM_AGENT: Agent = {
  id: "system",
  name: "System",
  role: "",
  avatar: "⚠️",
  persona: "",
  tools: [],
  model: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export function ChatView({
  chat,
  members,
  initialMessages,
}: {
  chat: Chat;
  members: Agent[];
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<ClientMessage[]>(
    initialMessages.map((m) => ({
      ...m,
      mentions: m.mentions ?? [],
      toolCalls: m.toolCalls ?? [],
      agent: members.find((a) => a.id === m.senderId) ?? null,
    })),
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Append or update a streaming agent message
  const upsertStreamingMessage = useCallback(
    (agentId: string, updater: (msg: ClientMessage) => ClientMessage) => {
      setMessages((prev) => {
        const idx = prev.findIndex(
          (m) => m.senderId === agentId && m.streaming,
        );
        if (idx === -1) {
          const agent = members.find((a) => a.id === agentId) ?? null;
          const newMsg: ClientMessage = {
            id: `streaming-${agentId}-${Date.now()}`,
            chatId: chat.id,
            senderId: agentId,
            senderType: "agent",
            content: "",
            mentions: [],
            toolCalls: [],
            createdAt: new Date(),
            streaming: true,
            agent,
          };
          return [...prev, updater(newMsg)];
        }
        const updated = [...prev];
        updated[idx] = updater(updated[idx]);
        return updated;
      });
    },
    [chat.id, members],
  );

  async function sendMessage(text: string, mentions: string[]) {
    // Add the human message immediately
    const humanMsg: ClientMessage = {
      id: `temp-${Date.now()}`,
      chatId: chat.id,
      senderId: "local-user",
      senderType: "human",
      content: text,
      mentions,
      toolCalls: [],
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, humanMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chat.id, content: text, mentions }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            chatId: chat.id,
            senderId: "system",
            senderType: "agent",
            content: `Error: ${errText}`,
            mentions: [],
            toolCalls: [],
            createdAt: new Date(),
            agent: SYSTEM_AGENT,
          },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const event: StreamingEvent = JSON.parse(data);

            switch (event.type) {
              case "agent_start":
                upsertStreamingMessage(event.agentId, (m) => m);
                break;
              case "token":
                upsertStreamingMessage(event.agentId, (m) => ({
                  ...m,
                  content: m.content + event.text,
                }));
                break;
              case "tool_call":
                upsertStreamingMessage(event.agentId, (m) => ({
                  ...m,
                  toolCalls: [
                    ...(m.toolCalls ?? []),
                    { tool: event.tool, args: event.args },
                  ],
                }));
                break;
              case "tool_result":
                upsertStreamingMessage(event.agentId, (m) => ({
                  ...m,
                  toolCalls: (m.toolCalls ?? []).map((tc, i) =>
                    i === (m.toolCalls ?? []).length - 1
                      ? { ...tc, result: event.result, error: event.error }
                      : tc,
                  ),
                }));
                break;
              case "message_end":
                // Finalize the streaming message
                setMessages((prev) =>
                  prev.map((m) =>
                    m.senderId === event.agentId && m.streaming
                      ? {
                          ...m,
                          id: event.messageId,
                          content: event.content,
                          streaming: false,
                        }
                      : m,
                  ),
                );
                break;
              case "error":
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `err-${Date.now()}`,
                    chatId: chat.id,
                    senderId: "system",
                    senderType: "agent",
                    content: `Error: ${event.message}`,
                    mentions: [],
                    toolCalls: [],
                    createdAt: new Date(),
                    agent: SYSTEM_AGENT,
                  },
                ]);
                break;
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            chatId: chat.id,
            senderId: "system",
            senderType: "agent",
            content: `Connection error: ${err.message}`,
            mentions: [],
            toolCalls: [],
            createdAt: new Date(),
            agent: SYSTEM_AGENT,
          },
        ]);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Chat header — hidden on mobile (top bar in shell handles it) */}
      <div className="hidden items-center gap-2 border-b border-border px-4 py-2.5 md:flex">
        <div className="flex items-center gap-2">
          {chat.type === "group" ? (
            <span className="flex -space-x-1">
              {members.slice(0, 4).map((m) => (
                <span
                  key={m.id}
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background text-xs"
                >
                  {m.avatar}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-lg">{members[0]?.avatar ?? "💬"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{chat.name}</h2>
          {chat.type === "group" && (
            <p className="truncate text-xs text-muted-foreground">
              {members.map((m) => m.name).join(", ")}
            </p>
          )}
        </div>
      </div>

      {/* Mobile chat sub-header — shows current chat name under the top bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
        <span className="text-base">
          {chat.type === "group" ? "👥" : (members[0]?.avatar ?? "💬")}
        </span>
        <span className="truncate text-sm font-semibold">{chat.name}</span>
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Input */}
      <MessageInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        members={members}
        chatType={chat.type}
        routingMode={chat.routingMode}
      />
    </div>
  );
}
