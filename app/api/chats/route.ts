import { NextRequest } from "next/server";
import { supabase } from "@/db/client";
import type { Chat, ChatMember } from "@/db/schema-types";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { nanoid } from "nanoid";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const [{ data: chats }, { data: members }] = await Promise.all([
    supabase.from("chats").select("*"),
    supabase.from("chat_members").select("*"),
  ]);

  const chatList = (chats ?? []) as Chat[];
  const memberList = (members ?? []) as ChatMember[];

  return Response.json(
    chatList.map((chat) => ({
      id: chat.id,
      name: chat.name,
      type: chat.type,
      routingMode: chat.routing_mode,
      isDefault: chat.is_default,
      members: memberList
        .filter((m) => m.chat_id === chat.id)
        .map((m) => m.agent_id),
    })),
  );
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { name, agentIds, routingMode } = await req.json() as {
    name: string;
    agentIds: string[];
    routingMode: "mentioned_only" | "all_members";
  };

  if (!name || !agentIds || agentIds.length === 0) {
    return new Response("Missing name or agentIds", { status: 400 });
  }

  const chatId = nanoid();
  const isDm = agentIds.length === 1;

  const { error: chatError } = await supabase.from("chats").insert({
    id: chatId,
    name,
    type: isDm ? "dm" : "group",
    routing_mode: routingMode ?? "mentioned_only",
    is_default: false,
  });

  if (chatError) return new Response(chatError.message, { status: 500 });

  const memberInserts = agentIds.map((agentId) => ({ chat_id: chatId, agent_id: agentId }));
  const { error: memberError } = await supabase.from("chat_members").insert(memberInserts);

  if (memberError) return new Response(memberError.message, { status: 500 });

  return Response.json({ id: chatId });
}
