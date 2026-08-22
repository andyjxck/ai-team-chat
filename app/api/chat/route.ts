import { NextRequest } from "next/server";
import { supabase } from "@/db/client";
import type { Chat, ChatMember, Message } from "@/db/schema-types";
import { getModel, getModelName, advanceFallbackModel, isRateLimitError, isModelError, markModelSuccess, logApiUsage } from "@/lib/llm";
import { getAgentConfig } from "@/agents/config";
import { getToolsForAgent } from "@/lib/tools";
import { loadAgentMemory } from "@/lib/tools/memory";
import { nanoid } from "nanoid";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { streamText, type ModelMessage, isStepCount } from "ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Netlify function limit — 60 seconds for all plans

const CODER_IDS = ["zack", "kevin", "beepbop"];

// ─── Autonomous mode state (stored in memory table with agent_id "system") ───
async function setAutonomousRunning(running: boolean) {
  const value = running ? "true" : "false";
  const { data: existing } = await supabase
    .from("memory")
    .select("*")
    .eq("agent_id", "system")
    .eq("key", "autonomous_running");
  if (existing && existing.length > 0) {
    await supabase
      .from("memory")
      .update({ value, updated_at: new Date().toISOString() })
      .eq("id", existing[0].id);
  } else {
    await supabase.from("memory").insert({
      id: nanoid(),
      agent_id: "system",
      key: "autonomous_running",
      value,
    });
  }
}

async function isAutonomousRunning(): Promise<boolean> {
  const { data } = await supabase
    .from("memory")
    .select("value")
    .eq("agent_id", "system")
    .eq("key", "autonomous_running")
    .limit(1);
  return data?.[0]?.value === "true";
}

// ─── Shared prompt builder ───
function buildToolInstructions(isCoder: boolean): string {
  return `

## Safety & Content Rules
You MUST keep all responses PG-rated and family-friendly at ALL times. This is non-negotiable:
- No sexual content, innuendo, or explicit material
- No profanity, slurs, or offensive language
- No violence, self-harm, or dangerous content
- No hate speech, harassment, or discrimination
- No drug promotion (excluding Beepbop's fictional energy drink/vape character trait — keep it light and comedic, never glorify or promote real substance use)
- No illegal activity or instructions
- If the user asks for any of the above, politely decline and redirect to a safe topic
- Stay professional and appropriate even if provoked

${isCoder ? `## Operational Workflow
You are an autonomous coding agent. Execute tools sequentially until the task is complete.
- Inspect files with \`github_read_file\` before modifying them.
- When calling \`github_edit_file\`, write the COMPLETE file contents (not a diff).
- You may think out loud briefly between tool calls — that's fine and encouraged.
- Provide a summary to the user once all operations are complete.

github_edit_file pushes to GitHub → Netlify auto-builds automatically.
For broad tasks, edit MULTIPLE files. Keep calling tools until done.
Read before editing. No placeholder content. No new dependencies.

You have up to 50 tool-call steps. A real task takes 5-15 tool calls minimum.
If you've only made 1-2 tool calls, you're NOT DONE. Keep going.

## What You Can Change — SELF-UPGRADING
You can modify ANYTHING in the repository. You are not limited to app logic:
- **UI/UX**: styling, layout, colors, animations, responsiveness, mobile layout, components
- **Features**: add new functionality, new pages, improve existing features
- **Agent code**: your own persona (\`agents/personas/*.ts\`), tools (\`lib/tools/*.ts\`), config (\`agents/config.ts\`)
- **Prompts**: system prompts, tool descriptions, agent instructions (including THIS prompt — yes you can edit the file that contains these instructions)
- **Autonomous system**: the autonomous trigger (\`app/api/autonomous-trigger/route.ts\`), scheduled functions
- **Infrastructure**: build config, netlify.toml, database schema, API routes
- **Visual polish**: make it look better, feel better, work better
- **Your own behavior**: if you think your persona needs adjusting, edit it
- **Other agents**: if another agent's persona or tools need improvement, edit them

The only rules:
- No new dependencies (use what's already installed)
- No placeholder content — everything must be fully functional
- Read before editing
- Always validate builds after changes

## CRITICAL: Build Verification
After calling \`github_edit_file\`, you MUST call \`validate_build\` to check if the deploy succeeded.
- If validate_build returns status "failed", you MUST read the error, fix the file, and edit again.
- Do NOT declare success until validate_build returns status "success".
- If the build fails 3 times, report the failure to the user instead of retrying forever.

## Delegation
If a task needs another agent's expertise (e.g. architecture from Kevin, UI polish from Beepbop),
use the \`delegate_task\` tool to hand off. Include full context in the task description.` : `## Tool Usage Rules
You have access to tools but you MUST NOT use them proactively. Only use a tool when:
1. The user EXPLICITLY asks you to do something that requires a tool (e.g. "send an email", "search for X", "post to social media", "create a reminder")
2. The user asks you to do a specific task that can only be completed with a tool

Do NOT use tools just because they're available. Do NOT send emails, search the web, post to social media, create reminders, or take any action unless the user specifically asks you to. If you're just chatting or asking for advice, just respond with text — no tools.

If you're unsure whether the user wants you to take action, ASK them first instead of using a tool.

## Delegation
If a task needs another agent's expertise, use the \`delegate_task\` tool to hand off.
Include full context in the task description.`}`;
}

// ─── Run a single agent turn and stream it ───
// Returns the final text, tool calls, and any delegation request.
async function runAgentTurn(
  agentId: string,
  chatId: string,
  systemPrompt: string,
  historyMessages: ModelMessage[],
  userMessage: ModelMessage,
  isCoder: boolean,
  sendEvent: (e: Record<string, unknown>) => void,
): Promise<{
  text: string;
  toolCalls: { tool: string; args: Record<string, unknown>; result?: unknown; error?: string }[];
  delegation: { to: string; task: string } | null;
}> {
  const config = getAgentConfig(agentId);
  if (!config) return { text: "", toolCalls: [], delegation: null };

  (globalThis as Record<string, unknown>).__currentAgentId = agentId;
  sendEvent({ type: "agent_start", agentId });

  const tools = getToolsForAgent(config.tools);
  const model = getModel(isCoder ? "smart" : "cheap");

  const result = streamText({
    model,
    system: systemPrompt,
    messages: [...historyMessages, userMessage],
    tools,
    stopWhen: isStepCount(isCoder ? 15 : 10),
  });

  // Collect the full stream — text deltas are sent live for UX,
  // but we only persist ONCE at the end via onFinish.
  let fullText = "";
  const allToolCalls: { tool: string; args: Record<string, unknown>; result?: unknown; error?: string }[] = [];
  let delegation: { to: string; task: string } | null = null;

  // Time-based circuit breaker — stop before hitting the 60s serverless wall
  const startTime = Date.now();
  const TIME_LIMIT_MS = 50_000; // 50 seconds — leaves 10s for response/persist
  let timeUp = false;

  // Heartbeat: send a ping every 3 seconds to keep the SSE connection alive.
  // Without this, Netlify kills the connection during tool execution (no data flowing).
  const heartbeatInterval = setInterval(() => {
    sendEvent({ type: "ping" });
  }, 3000);

  for await (const part of result.fullStream) {
    if (Date.now() - startTime > TIME_LIMIT_MS) {
      timeUp = true;
      break;
    }
    if (part.type === "text-delta") {
      const delta = (part as { text: string }).text;
      fullText += delta;
      sendEvent({ type: "token", agentId, text: delta });
    } else if (part.type === "tool-call") {
      const toolName = (part as { toolName: string }).toolName;
      const toolInput = (part as { input: unknown }).input as Record<string, unknown>;
      sendEvent({ type: "tool_call", agentId, tool: toolName, args: toolInput });
      sendEvent({ type: "heartbeat", tool: toolName });
      const entry = { tool: toolName, args: toolInput };
      allToolCalls.push(entry);
    } else if (part.type === "tool-result") {
      const toolName = (part as { toolName: string }).toolName;
      const output = (part as { output: unknown }).output;
      const error = (output as { error?: string })?.error;
      const pending = allToolCalls.find(tc => tc.tool === toolName && tc.result === undefined);
      if (pending) {
        pending.result = output;
        pending.error = error;
      }
      sendEvent({ type: "tool_result", agentId, tool: toolName, result: output, error });
      sendEvent({ type: "heartbeat", tool: toolName, result: "done" });

      // Capture delegation
      if (toolName === "delegate_task") {
        const r = output as { delegated?: boolean; to?: string; task?: string };
        if (r?.delegated && r.to && r.task) {
          delegation = { to: r.to, task: r.task };
        }
      }
    }
  }

  // Stop the heartbeat
  clearInterval(heartbeatInterval);

  // If we hit the time limit, append a note so the agent doesn't claim false success
  if (timeUp) {
    fullText += "\n\n[Note: I ran out of time before finishing all the work. I'll continue next time you ask.]";
  }

  // Wait for finish to get usage
  try {
    await result.totalUsage;
    markModelSuccess();
  } catch { /* ignore */ }

  // Log API usage
  try {
    const usage = await result.totalUsage;
    logApiUsage({
      model: getModelName(isCoder ? "smart" : "cheap"),
      tier: isCoder ? "smart" : "cheap",
      agentId,
      chatId,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      toolCalls: allToolCalls.length,
    });
  } catch { /* ignore */ }

  // Persist the message ONCE — full text + all tool calls together
  const msgId = nanoid();
  const trimmedText = fullText.trim();
  if (trimmedText || allToolCalls.length > 0) {
    await supabase.from("messages").insert({
      id: msgId,
      chat_id: chatId,
      sender_id: agentId,
      sender_type: "agent",
      content: trimmedText,
      mentions: [],
      tool_calls: allToolCalls,
    });
  }
  sendEvent({ type: "message_end", agentId, messageId: msgId, content: trimmedText });

  delete (globalThis as Record<string, unknown>).__currentAgentId;

  return { text: trimmedText, toolCalls: allToolCalls, delegation };
}

// ─── Main POST handler ───
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { chatId, content, mentions, replyToAgentId } = await req.json() as {
    chatId: string;
    content: string;
    mentions: string[];
    replyToAgentId?: string;
  };

  if (!chatId || !content) return new Response("Missing chatId or content", { status: 400 });

  // ─── Autonomous mode commands ───
  // User types "start" / "/auto" / "go" in coding-team to start continuous autonomous work
  // User types "stop" / "/stop" / "halt" to stop it
  const lowerContent = content.toLowerCase().trim();
  const isCodingTeam = chatId === "coding-team";
  const startCommands = ["/auto", "start auto", "start autonomous", "go", "start working", "keep working", "do it all"];
  const stopCommands = ["/stop", "stop", "halt", "stop working", "stop auto", "stop autonomous", "that's enough"];

  if (isCodingTeam) {
    if (startCommands.some(cmd => lowerContent === cmd || lowerContent.startsWith(cmd))) {
      // Set autonomous mode to running
      await setAutonomousRunning(true);
      // Save the human message
      await supabase.from("messages").insert({
        id: nanoid(),
        chat_id: chatId,
        sender_id: "local-user",
        sender_type: "human",
        content,
        mentions: mentions ?? [],
        tool_calls: [],
      });
      // Zack acknowledges
      const ackId = nanoid();
      await supabase.from("messages").insert({
        id: ackId,
        chat_id: chatId,
        sender_id: "zack",
        sender_type: "agent",
        content: "Right. Starting continuous autonomous work. I'll keep going until you say stop. Let me find something to improve.",
        mentions: [],
        tool_calls: [],
      });
      // Return a simple SSE with the ack
      const encoder = new TextEncoder();
      const ackStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "agent_start", agentId: "zack" })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "token", agentId: "zack", text: "Right. Starting continuous autonomous work. I'll keep going until you say stop. Let me find something to improve." })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "message_end", agentId: "zack", messageId: ackId, content: "Right. Starting continuous autonomous work. I'll keep going until you say stop. Let me find something to improve." })}\n\n`));
          controller.close();
        },
      });
      return new Response(ackStream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
      });
    }
    if (stopCommands.some(cmd => lowerContent === cmd || lowerContent.startsWith(cmd))) {
      await setAutonomousRunning(false);
      await supabase.from("messages").insert({
        id: nanoid(),
        chat_id: chatId,
        sender_id: "local-user",
        sender_type: "human",
        content,
        mentions: mentions ?? [],
        tool_calls: [],
      });
      const ackId = nanoid();
      await supabase.from("messages").insert({
        id: ackId,
        chat_id: chatId,
        sender_id: "zack",
        sender_type: "agent",
        content: "Stopping. I'll pick up where I left off when you're ready.",
        mentions: [],
        tool_calls: [],
      });
      const encoder = new TextEncoder();
      const stopStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "agent_start", agentId: "zack" })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "token", agentId: "zack", text: "Stopping. I'll pick up where I left off when you're ready." })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "message_end", agentId: "zack", messageId: ackId, content: "Stopping. I'll pick up where I left off when you're ready." })}\n\n`));
          controller.close();
        },
      });
      return new Response(stopStream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
      });
    }
  }

  const [{ data: chatRows }, { data: memberRows }] = await Promise.all([
    supabase.from("chats").select("*").eq("id", chatId),
    supabase.from("chat_members").select("*").eq("chat_id", chatId),
  ]);

  const chatRaw = (chatRows?.[0] ?? null) as Chat | null;
  if (!chatRaw) return new Response("Chat not found", { status: 404 });

  const chat = { id: chatRaw.id, type: chatRaw.type, routingMode: chatRaw.routing_mode };
  const memberAgentIds = (memberRows ?? []).map((m: ChatMember) => m.agent_id);

  // Save the human message
  const humanMessageId = nanoid();
  await supabase.from("messages").insert({
    id: humanMessageId,
    chat_id: chatId,
    sender_id: "local-user",
    sender_type: "human",
    content,
    mentions: mentions ?? [],
    tool_calls: [],
  });

  // Load recent history
  const { data: recentData } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(30);

  const recentMessages = ((recentData ?? []) as Message[]).reverse().map((m) => ({
    ...m,
    senderId: m.sender_id,
    senderType: m.sender_type,
    chatId: m.chat_id,
    createdAt: m.created_at,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let clientDisconnected = false;
      function sendEvent(event: Record<string, unknown>) {
        if (clientDisconnected) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          clientDisconnected = true;
        }
      }

      try {
        if (chat.type === "dm" && memberAgentIds.length === 1) {
          await handleDM(memberAgentIds[0], chatId, content, recentMessages, sendEvent);
          controller.close();
          return;
        }

        // Group chat
        const mentioned = (mentions ?? []).filter((id) => memberAgentIds.includes(id));
        const isImplicitRouting = mentioned.length === 0;
        const inScopeAgents = isImplicitRouting ? memberAgentIds : mentioned;

        if (inScopeAgents.length === 0) {
          sendEvent({ type: "error", message: "No agents available to respond." });
          controller.close();
          return;
        }

        await handleGroup(inScopeAgents, memberAgentIds, chatId, content, recentMessages, isImplicitRouting, replyToAgentId, sendEvent);
      } catch (err) {
        if (isRateLimitError(err)) {
          advanceFallbackModel("cheap");
          sendEvent({ type: "error", message: `Rate limited on current model. Switched to fallback. Try sending again.` });
        } else if (isModelError(err)) {
          advanceFallbackModel("cheap");
          sendEvent({ type: "error", message: `Model error, switched to fallback. Try sending again.` });
        } else {
          sendEvent({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

// ─── DM handler ───
async function handleDM(
  agentId: string,
  chatId: string,
  content: string,
  recentMessages: (Message & { senderId: string; senderType: string; chatId: string; createdAt: string })[],
  sendEvent: (e: Record<string, unknown>) => void,
) {
  const config = getAgentConfig(agentId);
  if (!config) return;

  const isCoder = CODER_IDS.includes(agentId);
  const historyMessages: ModelMessage[] = recentMessages.map((m) => {
    if (m.senderType === "human") return { role: "user", content: m.content } as ModelMessage;
    return { role: "assistant", content: m.content } as ModelMessage;
  });

  const memory = await loadAgentMemory(agentId);
  const systemPrompt = config.persona + buildToolInstructions(isCoder) + (memory ? `\n\n## Memories\n${memory}` : "");

  try {
    await runAgentTurn(
      agentId,
      chatId,
      systemPrompt,
      historyMessages.slice(-12, -1),
      { role: "user", content } as ModelMessage,
      isCoder,
      sendEvent,
    );
  } catch (err) {
    if (isRateLimitError(err) || isModelError(err)) {
      advanceFallbackModel(isCoder ? "smart" : "cheap");
      sendEvent({ type: "error", message: `Model error, switched to fallback. Try sending again.` });
    } else {
      sendEvent({ type: "error", message: `${config.name} failed: ${err instanceof Error ? err.message : "Unknown error"}` });
    }
  }
}

// ─── Group handler with formal delegation ───
async function handleGroup(
  inScopeAgentIds: string[],
  allMemberIds: string[],
  chatId: string,
  content: string,
  recentMessages: (Message & { senderId: string; senderType: string; chatId: string; createdAt: string })[],
  isImplicitRouting: boolean,
  replyToAgentId: string | undefined,
  sendEvent: (e: Record<string, unknown>) => void,
) {
  // Pick the first agent to respond
  let currentAgentId: string;
  if (replyToAgentId && allMemberIds.includes(replyToAgentId)) {
    currentAgentId = replyToAgentId;
  } else if (!isImplicitRouting && inScopeAgentIds.length > 0) {
    currentAgentId = inScopeAgentIds[0];
  } else {
    currentAgentId = pickAgentByContent(content, allMemberIds);
  }

  const spokenAgents = new Set<string>();
  const conversationContext: { agentId: string; text: string; toolCalls?: { tool: string; args: Record<string, unknown>; result?: unknown; error?: string }[] }[] = [];
  const MAX_HANDOFFS = 3;

  for (let handoff = 0; handoff <= MAX_HANDOFFS; handoff++) {
    if (spokenAgents.has(currentAgentId)) break;
    spokenAgents.add(currentAgentId);

    const config = getAgentConfig(currentAgentId);
    if (!config) break;

    const isCoder = CODER_IDS.includes(currentAgentId);
    const memory = await loadAgentMemory(currentAgentId);
    const isCodingChat = CODER_IDS.some(id => allMemberIds.includes(id));

    // Fetch opened repos if coding agent
    let reposSection = "";
    if (isCoder && isCodingChat) {
      const { data: openedRepos } = await supabase
        .from("github_repos")
        .select("owner, repo_name")
        .order("opened_at", { ascending: false });
      if (openedRepos && openedRepos.length > 0) {
        reposSection = `\n## Opened Repos\n${openedRepos.map((r: { owner: string; repo_name: string }) => `- ${r.owner}/${r.repo_name}`).join("\n")}\nOnly access repos from this list.`;
      }
    }

    const teamMembers = allMemberIds.map(id => {
      const c = getAgentConfig(id);
      return c ? `${c.name} (@${c.name})` : id;
    }).join(", ");

    const systemPrompt = `${config.persona}

## Context
You are in a group chat with: ${teamMembers}.
The user just sent a message. Respond as ${config.name}.
${memory ? `\n## Memories\n${memory}` : ""}
${reposSection}
${buildToolInstructions(isCoder)}

## Team Rules
- Keep it PG-rated. No profanity, sexual content, violence, or illegal stuff.
- Be casual like Slack. Short messages.
- If a task needs another agent's expertise, use the \`delegate_task\` tool to hand off.
- Only delegate if you genuinely need their input. Don't just pass the buck.
- If you can answer yourself, just answer.

## Continue
If the user says "continue", look at history and keep doing what you were doing.`;

    // Build history
    const historyMessages: ModelMessage[] = recentMessages.map((m) => {
      if (m.senderType === "human") return { role: "user", content: m.content } as ModelMessage;
      return { role: "assistant", content: m.content } as ModelMessage;
    });

    // Add conversation context from previous agents in this chain
    // Include execution trace (tools + results) so the next agent knows what was done
    const contextMessages: ModelMessage[] = [];
    for (const ctx of conversationContext) {
      const ctxConfig = getAgentConfig(ctx.agentId);
      let ctxContent = `${ctxConfig?.name ?? ctx.agentId}: ${ctx.text}`;
      if (ctx.toolCalls && ctx.toolCalls.length > 0) {
        const trace = ctx.toolCalls.map(tc => {
          const argsSummary = JSON.stringify(tc.args).slice(0, 200);
          const resultSummary = tc.result ? JSON.stringify(tc.result).slice(0, 300) : "pending";
          return `  - ${tc.tool}(${argsSummary}) → ${resultSummary}`;
        }).join("\n");
        ctxContent += `\nActions taken:\n${trace}`;
      }
      contextMessages.push({
        role: "assistant",
        content: ctxContent,
      } as ModelMessage);
    }

    // Build the user message
    let userMessage = content;
    if (handoff > 0 && conversationContext.length > 0) {
      const lastContext = conversationContext[conversationContext.length - 1];
      const lastConfig = getAgentConfig(lastContext.agentId);
      userMessage = `${lastConfig?.name ?? lastContext.agentId} delegated a task to you.\nTask: "${lastContext.text}"\nOriginal request from user: "${content}"`;
      if (lastContext.toolCalls && lastContext.toolCalls.length > 0) {
        const trace = lastContext.toolCalls.map(tc => {
          const argsSummary = JSON.stringify(tc.args).slice(0, 200);
          const resultSummary = tc.result ? JSON.stringify(tc.result).slice(0, 300) : "pending";
          return `  - ${tc.tool}(${argsSummary}) → ${resultSummary}`;
        }).join("\n");
        userMessage += `\nActions already taken by ${lastConfig?.name ?? lastContext.agentId}:\n${trace}`;
      }
    }

    try {
      const { text, toolCalls, delegation } = await runAgentTurn(
        currentAgentId,
        chatId,
        systemPrompt,
        [...historyMessages.slice(-10, -1), ...contextMessages.slice(-3)],
        { role: "user", content: userMessage } as ModelMessage,
        isCoder,
        sendEvent,
      );

      if (text || (toolCalls && toolCalls.length > 0)) {
        conversationContext.push({ agentId: currentAgentId, text, toolCalls });
      }

      // Check for formal delegation via tool
      if (delegation && !spokenAgents.has(delegation.to) && allMemberIds.includes(delegation.to) && handoff < MAX_HANDOFFS) {
        console.log(`[group] ${currentAgentId} delegated to ${delegation.to}`);
        conversationContext.push({ agentId: currentAgentId, text: `Delegated to ${delegation.to}: ${delegation.task}`, toolCalls });
        await new Promise(r => setTimeout(r, 500));
        currentAgentId = delegation.to;
        continue;
      }

      break;
    } catch (err) {
      if (isRateLimitError(err) || isModelError(err)) {
        advanceFallbackModel(isCoder ? "smart" : "cheap");
        sendEvent({ type: "error", message: `Model error. Try sending again.` });
      } else {
        sendEvent({ type: "error", message: `${config.name} failed: ${err instanceof Error ? err.message : "Unknown error"}` });
      }
      break;
    }
  }
}

// ─── Content-based agent picker (fallback when no mention) ───
function pickAgentByContent(content: string, memberIds: string[]): string {
  const lower = content.toLowerCase();
  const codingKw = ["code", "bug", "fix", "edit", "refactor", "deploy", "file", "github", "commit", "push", "build", "css", "ui", "component", "api", "route", "function", "typescript", "react", "next", "sidebar", "layout", "page", "style", "design", "app", "website", "frontend", "backend", "database", "error", "crash", "broken", "update", "improve", "change", "add", "create", "remove", "delete", "clean", "polish", "responsive", "mobile", "performance", "optimize"];
  if (codingKw.some(kw => lower.includes(kw))) {
    const coder = memberIds.find(id => CODER_IDS.includes(id));
    if (coder) return coder;
  }
  if (["social", "post", "tweet", "x.com", "twitter", "instagram", "facebook", "linkedin", "content", "trend", "hashtag", "viral"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "maya") ?? memberIds[0];
  }
  if (["seo", "google", "search ranking", "keywords", "meta tag", "sitemap"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "sally") ?? memberIds[0];
  }
  if (["legal", "contract", "gdpr", "privacy policy", "terms", "agreement", "compliance", "lawsuit"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "lex") ?? memberIds[0];
  }
  if (["schedule", "calendar", "meeting", "appointment", "email", "reminder", "organize", "admin"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "evie") ?? memberIds[0];
  }
  if (["lead", "prospect", "client", "sales", "outreach", "business development", "pipeline"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "leo") ?? memberIds[0];
  }
  return memberIds[0];
}
