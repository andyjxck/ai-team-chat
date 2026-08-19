import { NextRequest } from "next/server";
import { supabase } from "@/db/client";
import type { Message } from "@/db/schema-types";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return new Response("Missing chatId", { status: 400 });

  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(100);

  const msgs = ((data ?? []) as Message[]).reverse().map((m) => ({
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

  return Response.json(msgs);
}
