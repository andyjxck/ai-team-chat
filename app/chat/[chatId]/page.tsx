import { db, schema } from "@/db/client";
import { notFound } from "next/navigation";
import { ChatView } from "@/components/chat-view";
import { desc, eq } from "drizzle-orm";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;

  const [chatRows, memberRows] = await Promise.all([
    db.select().from(schema.chats).where(eq(schema.chats.id, chatId)),
    db.select().from(schema.chatMembers).where(eq(schema.chatMembers.chatId, chatId)),
  ]);

  const chat = chatRows[0];
  if (!chat) notFound();

  // Load agents for each member
  const members = (
    await Promise.all(
      memberRows.map((m) =>
        db.select().from(schema.agents).where(eq(schema.agents.id, m.agentId)),
      ),
    )
  )
    .map((rows) => rows[0])
    .filter((a): a is NonNullable<typeof a> => a !== undefined);

  const rawMessages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(100);

  // Reverse to chronological order
  rawMessages.reverse();

  return (
    <ChatView
      chat={chat}
      members={members}
      initialMessages={rawMessages}
    />
  );
}
