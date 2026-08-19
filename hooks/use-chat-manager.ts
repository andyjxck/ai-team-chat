import { useState, useCallback, useRef } from "react";
import type { ClientMessage, ClientAgent, ClientChat, ToolCallRecord, DraftData, QuestionData, CodeChangeData } from "@/db/client-types";

// Types needed for hook
export type StreamingEvent =
  | { type: "agent_start"; agentId: string }
  | { type: "agent_skip"; agentId: string; name: string }
  | { type: "token"; agentId: string; text: string }
  | { type: "tool_call"; agentId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; agentId: string; tool: string; result: unknown; error?: string }
  | { type: "message_end"; agentId: string; messageId: string; content: string }
  | { type: "error"; message: string };

export function useChatManager(
  chat: ClientChat,
  members: ClientAgent[],
  initialMessages: ClientMessage[]
) {
  const [messages, setMessages] = useState<ClientMessage[]>(
    initialMessages.map((m) => ({
      ...m,
      mentions: m.mentions ?? [],
      toolCalls: m.toolCalls ?? [],
      agent: members.find((a) => a.id === m.senderId) ?? null,
    }))
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const upsertStreamingMessage = useCallback(
    (agentId: string, updater: (msg: ClientMessage) => ClientMessage) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.senderId === agentId && m.streaming);
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
    [chat.id, members]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const setMessagesExternally = useCallback((newMessages: ClientMessage[]) => {
    setMessages(newMessages);
  }, []);

  return {
    messages,
    isStreaming,
    setIsStreaming,
    abortRef,
    upsertStreamingMessage,
    stopStreaming,
    setMessages: setMessagesExternally
  };
}
