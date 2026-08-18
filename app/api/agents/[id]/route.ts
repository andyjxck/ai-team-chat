import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const { persona, tools } = await req.json() as {
    persona?: string;
    tools?: string[];
  };

  const agentRows = await db.select().from(schema.agents).where(eq(schema.agents.id, id));
  const agent = agentRows[0];
  if (!agent) return new Response("Not found", { status: 404 });

  await db
    .update(schema.agents)
    .set({
      ...(persona !== undefined ? { persona } : {}),
      ...(tools !== undefined ? { tools } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.agents.id, id));

  return Response.json({ ok: true });
}
