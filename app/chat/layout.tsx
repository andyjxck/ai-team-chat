import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { supabase } from "@/db/client";
import type { Chat, ChatMember, Agent, Message } from "@/db/schema-types";
import { ChatManager } from "@/components/chat-manager";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const userId = session.user.id; // Get current user's ID

  const [{ data: allChats }, { data: allMembers }, { data: allAgents }, { data: allMessages }] = await Promise.all([
    supabase.from("chats").select("*"),
    supabase.from("chat_members").select("*"),
    supabase.from("agents").select("*"),
    supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(100),
  ]);

  const chats = (allChats ?? []) as Chat[];
  const members = (allMembers ?? []) as ChatMember[];
  const agents = (allAgents ?? []) as Agent[];
  const messages = (allMessages ?? []) as Message[];

  // Map user's last viewed time for each chat
  const userLastViewed: Record<string, string | null> = {};
  members.filter(m => m.agent_id === userId && m.agent_type === "human").forEach(m => {
    userLastViewed[m.chat_id] = m.last_viewed_at;
  });

  // Build last message map
  const lastMessageByChat: Record<string, { content: string; createdAt: string; senderName: string }> = {};
  for (const m of messages) {
    if (!lastMessageByChat[m.chat_id]) {
      const agent = agents.find((a) => a.id === m.sender_id);
      lastMessageByChat[m.chat_id] = {
        content: m.content,
        createdAt: m.created_at,
        senderName: m.sender_type === "human" ? "You" : (agent?.name ?? "Agent"),
      };
    }
  }

  const chatsWithMembers = chats.map((chat) => {
    const chatLastMessage = lastMessageByChat[chat.id];
    const userChatLastViewed = userLastViewed[chat.id];

    // Determine unread status: if there's a last message and it's newer than the user's last viewed time
    const unread = chatLastMessage && userChatLastViewed
      ? new Date(chatLastMessage.createdAt).getTime() > new Date(userChatLastViewed).getTime()
      : chatLastMessage !== null; // If no last viewed, but there's a message, it's unread

    return {
      id: chat.id,
      name: chat.name,
      type: chat.type,
      routingMode: chat.routing_mode,
      isDefault: chat.is_default,
      members: members
        .filter((m) => m.chat_id === chat.id)
        .map((m) => agents.find((a) => a.id === m.agent_id))
        .filter((a): a is Agent => a !== undefined)
        .map((a) => ({ id: a.id, name: a.name, avatar: a.avatar, role: a.role })),
      lastMessage: chatLastMessage ?? null,
      unread, // Add the unread status
    };
  });

  return <ChatManager chats={chatsWithMembers}>{children}</ChatManager>;
}
