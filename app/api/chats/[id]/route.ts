import { NextRequest } from "next/server";
import { supabase } from "@/db/client";
import type { Chat, ChatMember, Agent, Message } from "@/db/schema-types";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const { data: chatRows } = await supabase.from("chats").select("*").eq("id", id);
  const chatRaw = (chatRows?.[0] ?? null) as Chat | null;
  if (!chatRaw) return new Response("Not found", { status: 404 });

  const chat = {
    id: chatRaw.id,
    name: chatRaw.name,
    type: chatRaw.type,
    routingMode: chatRaw.routing_mode,
    isDefault: chatRaw.is_default,
    createdAt: chatRaw.created_at,
  };

  // Get members
  const { data: memberRows } = await supabase.from("chat_members").select("*").eq("chat_id", id);
  const memberAgentIds = (memberRows ?? []).map((m: ChatMember) => m.agent_id);

  // Get agent details for members
  const { data: agentRows } = await supabase.from("agents").select("*").in("id", memberAgentIds);
  const members = ((agentRows ?? []) as Agent[]).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    avatar: a.avatar,
    persona: a.persona,
    tools: a.tools,
    model: a.model,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  }));

  // Get messages
  const { data: rawMessages } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  const messages = ((rawMessages ?? []) as Message[]).reverse().map((m) => ({
    id: m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    senderType: m.sender_type,
    content: m.content,
    mentions: m.mentions ?? [],
    parentMessageId: m.parent_message_id,
    toolCalls: m.tool_calls ?? [],
    createdAt: m.created_at,
  }));

  return Response.json({ chat, members, messages });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const { name, routingMode } = await req.json() as { name?: string; routingMode?: string };

  const { data: chatRows } = await supabase.from("chats").select("*").eq("id", id);
  const chat = (chatRows?.[0] ?? null) as Chat | null;
  if (!chat) return new Response("Not found", { status: 404 });

  const update: Record<string, unknown> = {};
  if (name) update.name = name;
  if (routingMode) update.routing_mode = routingMode;

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("chats").update(update).eq("id", id);
    if (error) return new Response(error.message, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const { data: chatRows } = await supabase.from("chats").select("*").eq("id", id);
  const chat = (chatRows?.[0] ?? null) as Chat | null;
  if (!chat) return new Response("Not found", { status: 404 });
  if (chat.is_default) return new Response("Cannot delete default chat", { status: 400 });

  await supabase.from("chat_members").delete().eq("chat_id", id);
  await supabase.from("messages").delete().eq("chat_id", id);
  await supabase.from("chats").delete().eq("id", id);

  return Response.json({ ok: true });
}
