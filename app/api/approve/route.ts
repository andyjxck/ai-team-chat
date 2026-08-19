import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ALL_TOOLS } from "@/lib/tools";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { actionType, actionData, chatId, agentId } = await req.json() as {
    actionType: string;
    actionData: Record<string, unknown>;
    chatId: string;
    agentId: string;
  };

  if (!actionType || !actionData) {
    return new Response("Missing actionType or actionData", { status: 400 });
  }

  // Set the agent context for tools that need it
  (globalThis as Record<string, unknown>).__currentAgentId = agentId;

  // Find the tool
  const tool = ALL_TOOLS[actionType as keyof typeof ALL_TOOLS];
  if (!tool || !tool.execute) {
    return Response.json({ error: `Unknown action: ${actionType}` }, { status: 400 });
  }

  try {
    const result = await tool.execute(actionData as never, { toolCallId: "approve", messages: [] } as never);
    return Response.json({ success: true, result });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Execution failed" },
      { status: 500 },
    );
  } finally {
    delete (globalThis as Record<string, unknown>).__currentAgentId;
  }
}
