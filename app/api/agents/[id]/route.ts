import { NextRequest } from "next/server";
import { supabase } from "@/db/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const { persona, tools } = await req.json() as { persona?: string; tools?: string[] };

  const { data } = await supabase.from("agents").select("*").eq("id", id);
  if (!data || data.length === 0) return new Response("Not found", { status: 404 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (persona !== undefined) update.persona = persona;
  if (tools !== undefined) update.tools = tools;

  const { error } = await supabase.from("agents").update(update).eq("id", id);
  if (error) return new Response(error.message, { status: 500 });

  return Response.json({ ok: true });
}
