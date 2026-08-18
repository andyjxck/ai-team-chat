import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return new Response("Missing chatId", { status: 400 });

  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(100);

  msgs.reverse();

  return Response.json(msgs);
}
