import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { nanoid } from "nanoid";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const [allChats, allMembers] = await Promise.all([
    db.select().from(schema.chats),
    db.select().from(schema.chatMembers),
  ]);

  return Response.json(
    allChats.map((chat) => ({
      ...chat,
      members: allMembers
        .filter((m) => m.chatId === chat.id)
        .map((m) => m.agentId),
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

  await db.insert(schema.chats).values({
    id: chatId,
    name,
    type: isDm ? "dm" : "group",
    routingMode: routingMode ?? "mentioned_only",
    isDefault: false,
  });

  for (const agentId of agentIds) {
    await db.insert(schema.chatMembers).values({ chatId, agentId });
  }

  return Response.json({ id: chatId });
}
