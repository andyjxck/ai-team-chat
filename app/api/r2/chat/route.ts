import { NextRequest } from "next/server";
import { streamText, type ModelMessage, isStepCount } from "ai";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getModel } from "@/lib/llm";
import { getAgentConfig } from "@/agents/config";
import { getToolsForAgent } from "@/lib/tools";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { agentId, message, fileContext, repoName, history } = await req.json() as {
    agentId: string;
    message: string;
    fileContext?: { path: string; content: string } | null;
    repoName?: string;
    history?: { role: string; content: string }[];
  };

  const config = getAgentConfig(agentId);
  if (!config) return new Response("Agent not found", { status: 404 });

  (globalThis as Record<string, unknown>).__currentAgentId = agentId;

  const tools = getToolsForAgent(config.tools);
  const model = getModel(config.model);

  // Build system prompt with file context
  let systemPrompt = config.persona;

  if (repoName) {
    systemPrompt += `\n\n## Current Context\nThe user is browsing their "${repoName}" repository in the repo viewer.`;
  }

  if (fileContext) {
    systemPrompt += `\n\n## Selected File\nThe user has selected this file:\nPath: ${fileContext.path}\n\n\`\`\`\n${fileContext.content}\n\`\`\`\n\nYou can see the full file content above. When suggesting edits, show the specific lines to change and what to change them to. Be specific and practical.`;
  } else {
    systemPrompt += `\n\nThe user has no file selected right now. You can suggest files to look at or give general advice.`;
  }

  // Build messages from history
  const messages: ModelMessage[] = (history ?? []).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }) as ModelMessage);
  messages.push({ role: "user", content: message } as ModelMessage);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const result = streamText({
          model,
          system: systemPrompt,
          messages,
          tools,
          stopWhen: isStepCount(5),
        });

        let fullText = "";
        for await (const delta of result.textStream) {
          fullText += delta;
          sendEvent({ type: "token", text: delta });
        }

        // Handle tool calls
        const toolCallResults = await result.toolCalls;
        const toolResultData = await result.toolResults;

        for (let i = 0; i < toolCallResults.length; i++) {
          const tc = toolCallResults[i] as { toolName: string; input: unknown };
          const toolName = String(tc.toolName);
          const args = tc.input as Record<string, unknown>;
          sendEvent({ type: "tool_call", tool: toolName, args });

          const tr = toolResultData[i] as { output: unknown } | undefined;
          if (tr) {
            const resultData = tr.output as unknown;
            sendEvent({ type: "tool_result", tool: toolName, result: resultData });

            // If the agent read a file via R2, include it in the response
            if (toolName === "r2_read_file" && resultData && typeof resultData === "object") {
              const r = resultData as { content?: string; path?: string };
              if (r.content) {
                sendEvent({ type: "file_read", path: r.path, content: r.content });
              }
            }
          }
        }

        sendEvent({ type: "done", content: fullText });
      } catch (err) {
        sendEvent({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
        delete (globalThis as Record<string, unknown>).__currentAgentId;
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
