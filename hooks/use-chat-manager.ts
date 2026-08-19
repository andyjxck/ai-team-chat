import { useState, useCallback, useRef } from "react";
import { ClientMessage, ClientChat, ClientAgent } from "@/db/client-types";

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

  return {
    messages,
    setMessages,
    isStreaming,
    setIsStreaming,
    abortRef,
    upsertStreamingMessage,
    stopStreaming,
  };
}
