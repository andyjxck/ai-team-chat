import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getModel } from "@/lib/llm";
import { getAgentConfig } from "@/agents/config";
import { nanoid } from "nanoid";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { chatId, content, mentions } = body as {
    chatId: string;
    content: string;
    mentions: string[];
  };

  if (!chatId || !content) {
    return new Response("Missing chatId or content", { status: 400 });
  }

  // Load chat + members
  const [chatRows, memberRows] = await Promise.all([
    db.select().from(schema.chats).where(eq(schema.chats.id, chatId)),
    db.select().from(schema.chatMembers).where(eq(schema.chatMembers.chatId, chatId)),
  ]);

  const chat = chatRows[0];
  if (!chat) {
    return new Response("Chat not found", { status: 404 });
  }

  const memberAgentIds = memberRows.map((m) => m.agentId);

  // Save the human message
  const humanMessageId = nanoid();
  await db.insert(schema.messages).values({
    id: humanMessageId,
    chatId,
    senderId: "local-user",
    senderType: "human",
    content,
    mentions: mentions ?? [],
    toolCalls: [],
  });

  // Determine which agents should respond
  let respondingAgents: string[];

  if (chat.type === "dm") {
    respondingAgents = memberAgentIds;
  } else if (chat.routingMode === "all_members") {
    respondingAgents = memberAgentIds;
  } else {
    respondingAgents = (mentions ?? []).filter((id) =>
      memberAgentIds.includes(id),
    );
  }

  if (respondingAgents.length === 0) {
    const stream = new ReadableStream({
      start(controller) {
        const event = {
          type: "error",
          message:
            chat.type === "group" && chat.routingMode === "mentioned_only"
              ? "No one was mentioned. Use @ to address a team member."
              : "No agents available to respond.",
        };
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Load recent history for context
  const recentMessages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(30);

  recentMessages.reverse();

  // Build the SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        for (const agentId of respondingAgents) {
          const config = getAgentConfig(agentId);
          if (!config) continue;

          sendEvent({ type: "agent_start", agentId });

          // Build conversation history for this agent
          const historyMessages = recentMessages.map((m) => {
            if (m.senderType === "human") {
              return { role: "user" as const, content: m.content };
            }
            const agent = getAgentConfig(m.senderId);
            return {
              role: "assistant" as const,
              content: `${agent?.name ?? "Agent"}: ${m.content}`,
            };
          });

          // Add context about who else is in the chat
          const otherMembers = memberAgentIds
            .filter((id) => id !== agentId)
            .map((id) => getAgentConfig(id))
            .filter(Boolean)
            .map((a) => `${a!.name} (${a!.role})`);

          const contextNote =
            chat.type === "group" && otherMembers.length > 0
              ? `\n\nYou are in a group chat with: ${otherMembers.join(", ")}. You may reference them or suggest the user talk to them if relevant.`
              : "";

          const systemPrompt = `${config.persona}${contextNote}`;

          try {
            const model = getModel(config.model);
            const result = await streamTextSimple({
              model,
              systemPrompt,
              history: historyMessages,
              userMessage: content,
              onToken: (text) => {
                sendEvent({ type: "token", agentId, text });
              },
            });

            // Save the agent message
            const agentMessageId = nanoid();
            await db.insert(schema.messages).values({
              id: agentMessageId,
              chatId,
              senderId: agentId,
              senderType: "agent",
              content: result.text,
              mentions: [],
              toolCalls: [],
            });

            sendEvent({
              type: "message_end",
              agentId,
              messageId: agentMessageId,
              content: result.text,
            });
          } catch (err) {
            const errorMsg =
              err instanceof Error ? err.message : "Unknown error";
            sendEvent({
              type: "error",
              message: `${config.name} failed: ${errorMsg}`,
            });
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Simple streaming text without tools (step 2).
 * Will be replaced with full tool-using version in step 4.
 */
async function streamTextSimple({
  model,
  systemPrompt,
  history,
  userMessage,
  onToken,
}: {
  model: ReturnType<typeof getModel>;
  systemPrompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  onToken: (text: string) => void;
}): Promise<{ text: string }> {
  const { streamText } = await import("ai");

  const messages = [
    ...history.slice(0, -1),
    { role: "user" as const, content: userMessage },
  ];

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
  });

  let fullText = "";
  for await (const delta of result.textStream) {
    fullText += delta;
    onToken(delta);
  }

  return { text: fullText };
}
