import { useState, useCallback, useRef } from "react";
import type { ClientMessage, ClientAgent, ClientChat } from "@/db/client-types";

// Keep this hook as a clean orchestrator. 
// We will move all logic from ChatView here.
export function useChatManager(
  chat: ClientChat,
  members: ClientAgent[],
  initialMessages: ClientMessage[]
) {
  const [messages, setMessages] = useState<ClientMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string, mentions: string[], replyToAgentId?: string) => {
    // Logic will be moved here
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    stopStreaming,
  };
}
