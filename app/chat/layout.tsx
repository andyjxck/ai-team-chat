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

  const chatsWithMembers = chats.map((chat) => ({
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
    lastMessage: lastMessageByChat[chat.id] ?? null,
  }));

  return <ChatManager chats={chatsWithMembers}>{children}</ChatManager>;
}
