import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db, schema } from "@/db/client";
import { ChatShell } from "@/components/chat-shell";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const [allChats, allAgents, allMembers] = await Promise.all([
    db.select().from(schema.chats),
    db.select().from(schema.agents),
    db.select().from(schema.chatMembers),
  ]);

  const chatsWithMembers = allChats.map((chat) => ({
    ...chat,
    members: allMembers
      .filter((m) => m.chatId === chat.id)
      .map((m) => allAgents.find((a) => a.id === m.agentId))
      .filter((a): a is NonNullable<typeof a> => a !== undefined)
      .map((a) => ({ id: a.id, name: a.name, avatar: a.avatar, role: a.role })),
  }));

  return <ChatShell chats={chatsWithMembers}>{children}</ChatShell>;
}
