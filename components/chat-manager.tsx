"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { ChatShell } from "./chat-shell";
import { ChatView } from "./chat-view";
import type { ClientChat, ClientAgent, ClientMessage } from "@/db/client-types";

type SidebarChat = {
  id: string;
  name: string;
  type: string;
  routingMode: string;
  isDefault: boolean;
  members: { id: string; name: string; avatar: string | null; role: string }[];
  lastMessage: { content: string; createdAt: string; senderName: string } | null;
};

type ChatData = {
  chat: ClientChat;
  members: ClientAgent[];
  messages: ClientMessage[];
};

export function ChatManager({ chats, children }: { chats: SidebarChat[]; children?: React.ReactNode }) {
  const pathname = usePathname();
  const [activeChat, setActiveChat] = useState<ChatData | null>(null);
  const [loading, setLoading] = useState(true);

  // Extract chatId from pathname
  const chatId = pathname.startsWith("/chat/") && pathname !== "/chat/new"
    ? pathname.split("/chat/")[1]
    : null;

  const fetchChat = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/chats/${id}`);
      if (!res.ok) throw new Error("Failed to fetch chat");
      const data = await res.json();
      setActiveChat(data);
    } catch (err) {
      console.error("Failed to fetch chat:", err);
      setActiveChat(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (chatId) {
      fetchChat(chatId);
    } else {
      setActiveChat(null);
      setLoading(false);
    }
  }, [chatId, fetchChat]);

  // Global autonomous work trigger — runs on every page while logged in
  useEffect(() => {
    const poll = async () => {
      try {
        await fetch("/api/autonomous-trigger", { method: "POST" });
      } catch { /* ignore */ }
    };
    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Live refresh: re-fetch active chat every 10s to see new messages
  // Only updates if there are MORE messages than before (avoids losing streaming state)
  useEffect(() => {
    if (!chatId) return;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/chats/${chatId}`);
        if (res.ok) {
          const data = await res.json();
          setActiveChat((prev) => {
            if (!prev) return data;
            const prevCount = prev.messages?.length ?? 0;
            const newCount = data.messages?.length ?? 0;
            // Only update if new messages appeared AND we're not in the middle of a stream
            // (detect streaming by checking if last message has streaming flag)
            const lastMsg = prev.messages?.[prevCount - 1];
            if (newCount > prevCount && !lastMsg?.streaming) {
              return data;
            }
            return prev;
          });
        }
      } catch { /* ignore */ }
    };
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [chatId]);

  return (
    <ChatShell chats={chats} activeChatName={activeChat?.chat.name}>
      <div className="flex flex-1 flex-col overflow-hidden">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-blue-500" />
              <p className="text-sm">Loading chat...</p>
            </div>
          </div>
        ) : activeChat ? (
          <ChatView
            key={activeChat.chat.id}
            chat={activeChat.chat}
            members={activeChat.members}
            initialMessages={activeChat.messages}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <p className="text-lg font-medium">Select a chat</p>
              <p className="text-sm">Choose a conversation from the sidebar.</p>
            </div>
          </div>
        )}
      </div>
    </ChatShell>
  );
}
