import { create } from "zustand";
import type { ClientMessage } from "@/db/client-types";

interface ChatStore {
  messages: ClientMessage[];
  isStreaming: boolean;
  setMessages: (messages: ClientMessage[]) => void;
  appendMessage: (message: ClientMessage) => void;
  updateMessage: (id: string, updater: (m: ClientMessage) => ClientMessage) => void;
  setIsStreaming: (isStreaming: boolean) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isStreaming: false,
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, updater) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? updater(m) : m)),
    })),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
}));
