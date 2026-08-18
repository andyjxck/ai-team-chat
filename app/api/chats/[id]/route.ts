import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const chatRows = await db.select().from(schema.chats).where(eq(schema.chats.id, id));
  const chat = chatRows[0];
  if (!chat) return new Response("Not found", { status: 404 });

  const members = await db
    .select()
    .from(schema.chatMembers)
    .where(eq(schema.chatMembers.chatId, id));

  return Response.json({ ...chat, members: members.map((m) => m.agentId) });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const { name, routingMode } = await req.json() as {
    name?: string;
    routingMode?: string;
  };

  const chatRows = await db.select().from(schema.chats).where(eq(schema.chats.id, id));
  const chat = chatRows[0];
  if (!chat) return new Response("Not found", { status: 404 });

  await db
    .update(schema.chats)
    .set({
      ...(name ? { name } : {}),
      ...(routingMode ? { routingMode } : {}),
    })
    .where(eq(schema.chats.id, id));

  return Response.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const chatRows = await db.select().from(schema.chats).where(eq(schema.chats.id, id));
  const chat = chatRows[0];
  if (!chat) return new Response("Not found", { status: 404 });
  if (chat.isDefault) return new Response("Cannot delete default chat", { status: 400 });

  await db.delete(schema.chatMembers).where(eq(schema.chatMembers.chatId, id));
  await db.delete(schema.messages).where(eq(schema.messages.chatId, id));
  await db.delete(schema.chats).where(eq(schema.chats.id, id));

  return Response.json({ ok: true });
}
