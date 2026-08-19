"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import type { ClientMessage, ClientAgent, ClientChat, ToolCallRecord, DraftData, QuestionData, CodeChangeData } from "@/db/client-types";
import { DraftCard } from "./draft-card";
import { QuestionCard } from "./question-card";
import { Avatar, AvatarGroup } from "./avatar";

export type { ClientMessage, ClientAgent, ClientChat, ToolCallRecord };

export type StreamingEvent =
  | { type: "agent_start"; agentId: string }
  | { type: "agent_skip"; agentId: string; name: string }
  | { type: "token"; agentId: string; text: string }
  | { type: "tool_call"; agentId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; agentId: string; tool: string; result: unknown; error?: string }
  | { type: "message_end"; agentId: string; messageId: string; content: string }
  | { type: "error"; message: string };

const SYSTEM_AGENT: ClientAgent = {
  id: "system",
  name: "System",
  role: "",
  avatar: "⚠️",
  persona: "",
  tools: [],
  model: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function ChatView({
  chat,
  members,
  initialMessages,
}: {
  chat: ClientChat;
  members: ClientAgent[];
  initialMessages: ClientMessage[];
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
            createdAt: new Date().toISOString(),
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

  async function sendMessage(text: string, mentions: string[], replyToAgentId?: string) {
    // Add the human message immediately
    const humanMsg: ClientMessage = {
      id: `temp-${Date.now()}`,
      chatId: chat.id,
      senderId: "local-user",
      senderType: "human",
      content: text,
      mentions,
      toolCalls: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, humanMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chat.id, content: text, mentions, replyToAgentId }),
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
            createdAt: new Date().toISOString(),
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
              case "agent_skip":
                // Remove the streaming placeholder for this agent
                setMessages((prev) => prev.filter((m) => !(m.senderId === event.agentId && m.streaming)));
                break;
              case "token":
                upsertStreamingMessage(event.agentId, (m) => ({
                  ...m,
                  content: m.content + event.text,
                }));
                break;
              case "tool_call":
                upsertStreamingMessage(event.agentId, (m) => {
                  const codeChanges = [...(m.codeChanges ?? [])];
                  // If code_edit is being called, add a "editing" state entry
                  if (event.tool === "code_edit") {
                    const args = event.args as { repo?: string; path?: string; description?: string };
                    if (args.repo && args.path) {
                      codeChanges.push({
                        repo: args.repo,
                        path: args.path,
                        description: args.description ?? "Editing file...",
                        oldContent: "",
                        newContent: "",
                        status: "pending",
                        agentId: event.agentId,
                      });
                    }
                  }
                  return {
                    ...m,
                    toolCalls: [
                      ...(m.toolCalls ?? []),
                      { tool: event.tool, args: event.args },
                    ],
                    codeChanges,
                  };
                });
                break;
              case "tool_result":
                upsertStreamingMessage(event.agentId, (m) => {
                  const toolCalls = (m.toolCalls ?? []).map((tc, i) =>
                    i === (m.toolCalls ?? []).length - 1
                      ? { ...tc, result: event.result, error: event.error }
                      : tc,
                  );
                  const lastCall = toolCalls[toolCalls.length - 1];
                  const drafts = [...(m.drafts ?? [])];
                  const questions = [...(m.questions ?? [])];
                  const codeChanges = [...(m.codeChanges ?? [])];

                  // Check if this is a draft_action result
                  if (lastCall && lastCall.tool === "draft_action" && event.result && typeof event.result === "object") {
                    const r = event.result as Record<string, unknown>;
                    if (r.draftId && r.status === "pending_approval") {
                      drafts.push(r as unknown as DraftData);
                    }
                  }

                  // Check if this is an ask_question result
                  if (lastCall && lastCall.tool === "ask_question" && event.result && typeof event.result === "object") {
                    const r = event.result as Record<string, unknown>;
                    if (r.questionId && r.question && r.options) {
                      questions.push(r as unknown as QuestionData);
                    }
                  }

                  // Check if this is a code_edit result — replace the "editing" entry
                  if (lastCall && lastCall.tool === "code_edit" && event.result && typeof event.result === "object") {
                    const r = event.result as Record<string, unknown>;
                    if (r.success && r.repo && r.path) {
                      // Find and replace the pending "editing" entry for this file
                      const replaceIdx = codeChanges.findIndex(
                        (c) => c.repo === r.repo && c.path === r.path && c.status === "pending",
                      );
                      const newChange = {
                        repo: r.repo as string,
                        path: r.path as string,
                        description: (r.description as string) ?? "Code edit",
                        oldContent: (r.oldContent as string) ?? "",
                        newContent: (r.newContent as string) ?? "",
                        changeId: (r.changeId as string) ?? "",
                        status: "applied" as const,
                        agentId: event.agentId,
                      };
                      if (replaceIdx >= 0) {
                        codeChanges[replaceIdx] = newChange;
                      } else {
                        codeChanges.push(newChange);
                      }
                    }
                  }

                  return { ...m, toolCalls, drafts, questions, codeChanges };
                });
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
                    createdAt: new Date().toISOString(),
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
            createdAt: new Date().toISOString(),
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

  // Update a draft within a message
  const updateDraft = useCallback((msgId: string, draft: DraftData) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? { ...m, drafts: (m.drafts ?? []).map((d) => (d.draftId === draft.draftId ? draft : d)) }
          : m,
      ),
    );
  }, []);

  // Handle question answer — mark as answered and send the answer as a message
  const handleQuestionAnswer = useCallback((msgId: string, questionId: string, answer: string) => {
    // Mark the question as answered
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              questions: (m.questions ?? []).map((q) =>
                q.questionId === questionId ? { ...q, answered: true, selected: answer } : q,
              ),
            }
          : m,
      ),
    );
    // Send the answer as a new message
    sendMessage(answer, []);
  }, [chat.id]);

  // Reply state
  const [replyTo, setReplyTo] = useState<ClientMessage | null>(null);

  function handleReply(msg: ClientMessage) {
    setReplyTo(msg);
  }

  function handleSend(text: string, mentions: string[]) {
    const replyAgentId = replyTo?.senderType === "agent" ? replyTo.senderId : undefined;
    const replyContext = replyTo;
    sendMessage(text, mentions, replyAgentId);
    setReplyTo(null);
    // Store reply context on the message
    if (replyContext) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 && m.senderType === "human"
            ? {
                ...m,
                replyTo: replyContext
                  ? { id: replyContext.id, senderName: replyContext.agent?.name ?? "You", content: replyContext.content.slice(0, 100) }
                  : null,
              }
            : m,
        ),
      );
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Chat header — premium with status and actions */}
      <div className="flex items-center gap-3 border-b border-border/50 bg-background/50 backdrop-blur-sm px-4 py-3">
        {chat.type === "group" ? (
          <AvatarGroup members={members.map(m => ({ id: m.id, avatar: m.avatar, name: m.name }))} size="sm" max={3} />
        ) : (
          <div className="relative">
            <Avatar
              id={members[0]?.id ?? "default"}
              emoji={members[0]?.avatar}
              name={members[0]?.name ?? chat.name}
              size="md"
            />
            <span className="online-indicator absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{chat.name}</h2>
          {chat.type === "group" ? (
            <p className="truncate text-xs text-muted-foreground">
              {members.map((m) => m.name).join(" · ")}
            </p>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs text-muted-foreground">{members[0]?.role}</span>
              <span className="h-1 w-1 rounded-full bg-green-500" />
              <span className="text-xs text-green-600 dark:text-green-400">online</span>
            </div>
          )}
        </div>
        {/* Status indicator for streaming */}
        {isStreaming && (
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            working...
          </div>
        )}
      </div>

      {/* Messages */}
      <MessageList
        messages={messages}
        onReply={handleReply}
        onDraftUpdate={updateDraft}
        onQuestionAnswer={handleQuestionAnswer}
        chatId={chat.id}
        members={members.map(m => ({ id: m.id, name: m.name, avatar: m.avatar, role: m.role }))}
      />

      {/* Input */}
      <MessageInput
        onSend={handleSend}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        members={members}
        chatType={chat.type}
        routingMode={chat.routingMode}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}
