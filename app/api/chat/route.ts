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
export const maxDuration = 60;

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

  const [{ data: chatRows }, { data: memberRows }] = await Promise.all([
    supabase.from("chats").select("*").eq("id", chatId),
    supabase.from("chat_members").select("*").eq("chat_id", chatId),
  ]);

  const chatRaw = (chatRows?.[0] ?? null) as Chat | null;
  if (!chatRaw) return new Response("Chat not found", { status: 404 });

  const chat = {
    id: chatRaw.id,
    type: chatRaw.type,
    routingMode: chatRaw.routing_mode,
  };

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
      function sendEvent(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        // ─── DM: single agent, simple call ───
        if (chat.type === "dm" && memberAgentIds.length === 1) {
          await handleDM(memberAgentIds[0], chatId, content, recentMessages, sendEvent);
          controller.close();
          return;
        }

        // ─── Group chat: single call for all agents ───
        // Determine which agents are in scope
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
          sendEvent({
            type: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
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

// ─── DM handler: single agent, with tools ───
async function handleDM(
  agentId: string,
  chatId: string,
  content: string,
  recentMessages: (Message & { senderId: string; senderType: string; chatId: string; createdAt: string })[],
  sendEvent: (e: Record<string, unknown>) => void,
) {
  const config = getAgentConfig(agentId);
  if (!config) return;

  // Tools read this to know which agent is calling them
  (globalThis as Record<string, unknown>).__currentAgentId = agentId;
  sendEvent({ type: "agent_start", agentId });

  const historyMessages: ModelMessage[] = recentMessages.map((m) => {
    if (m.senderType === "human") return { role: "user", content: m.content } as ModelMessage;
    const agent = getAgentConfig(m.senderId);
    return { role: "assistant", content: m.content } as ModelMessage;
  });

  const tools = getToolsForAgent(config.tools);

  const isCoder = ["zack", "kevin", "beepbop"].includes(agentId);
  try {
    const model = getModel(isCoder ? "smart" : "cheap");
    const toolInstructions = `

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

${isCoder ? `## Tool Usage
You are a coder with REAL GitHub tools. CALL them — don't write tool names as text.
- First: briefly say what you're going to do (1-2 sentences)
- Then: call tools to read and edit files
- Then: report what you actually did
- Read files with github_read_file, edit with github_edit_file (content = FULL file)
- github_edit_file pushes to GitHub → Netlify auto-builds. No deploy tool needed.
- Broad tasks = edit MULTIPLE files. One edit is not done. Keep going.
- No placeholder content. No new dependencies. Read before editing.
- If the user says "continue", keep doing what you were doing.` : `## Tool Usage Rules
You have access to tools but you MUST NOT use them proactively. Only use a tool when:
1. The user EXPLICITLY asks you to do something that requires a tool (e.g. "send an email", "search for X", "post to social media", "create a reminder")
2. The user asks you to do a specific task that can only be completed with a tool

Do NOT use tools just because they're available. Do NOT send emails, search the web, post to social media, create reminders, or take any action unless the user specifically asks you to. If the user is just chatting or asking for advice, just respond with text — no tools.

If you're unsure whether the user wants you to take action, ASK them first instead of using a tool.`}`;

    const result = streamText({
      model,
      system: config.persona + toolInstructions + await loadAgentMemory(agentId),
      messages: [...historyMessages.slice(-12, -1), { role: "user", content } as ModelMessage],
      tools,
      stopWhen: isStepCount(isCoder ? 50 : 30),
    });

    let fullText = "";
    const toolCalls: { tool: string; args: Record<string, unknown>; result?: unknown; error?: string }[] = [];

    // Use fullStream to get tool calls AND text in real-time
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        const delta = (part as { text: string }).text;
        fullText += delta;
        sendEvent({ type: "token", agentId, text: delta });
      } else if (part.type === "tool-call") {
        const toolName = (part as { toolName: string }).toolName;
        const toolInput = (part as { input: unknown }).input;
        sendEvent({ type: "tool_call", agentId, tool: toolName, args: toolInput });
        sendEvent({ type: "heartbeat", tool: toolName });
        toolCalls.push({ tool: toolName, args: toolInput as Record<string, unknown> });
      } else if (part.type === "tool-result") {
        const toolName = (part as { toolName: string }).toolName;
        const output = (part as { output: unknown }).output;
        const error = (output as { error?: string })?.error;
        // Update the tracked tool call with its result
        const pending = toolCalls.find(tc => tc.tool === toolName && tc.result === undefined);
        if (pending) {
          pending.result = output;
          pending.error = error;
        }
        sendEvent({ type: "tool_result", agentId, tool: toolName, result: output, error });
        sendEvent({ type: "heartbeat", tool: toolName, result: "done" });
      }
    }
    markModelSuccess();

    // Log API usage
    try {
      const usage = await result.totalUsage;
      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;
      logApiUsage({
        model: getModelName(isCoder ? "smart" : "cheap"),
        tier: isCoder ? "smart" : "cheap",
        agentId,
        chatId,
        inputTokens,
        outputTokens,
        toolCalls: toolCalls.length,
      });
    } catch { /* ignore usage errors */ }

    const agentMessageId = nanoid();
    await supabase.from("messages").insert({
      id: agentMessageId,
      chat_id: chatId,
      sender_id: agentId,
      sender_type: "agent",
      content: fullText,
      mentions: [],
      tool_calls: toolCalls,
    });
    sendEvent({ type: "message_end", agentId, messageId: agentMessageId, content: fullText });
  } catch (err) {
    if (isRateLimitError(err) || isModelError(err)) {
      advanceFallbackModel(isCoder ? "smart" : "cheap");
      sendEvent({ type: "error", message: `Model error, switched to fallback. Try sending again.` });
    } else {
      sendEvent({
        type: "error",
        message: `${config.name} failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  } finally {
    delete (globalThis as Record<string, unknown>).__currentAgentId;
  }
}


// ─── Group handler: sequential agent calls with @mention handoff ───
// Each agent gets their own focused API call — no markers, no parser.
// If an agent @mentions another agent, we make a follow-up call with that agent.
// All one continuous stream to the user.

const CODER_IDS = ["zack", "kevin", "beepbop"];

// Detect @mentions in agent output (e.g. "Let me ask @Zack about this")
function detectMention(text: string, allMemberIds: string[]): string | null {
  // Build a map of all possible names/ids for matching
  const nameMap: Record<string, string> = {};
  for (const id of allMemberIds) {
    const config = getAgentConfig(id);
    nameMap[id.toLowerCase()] = id;
    if (config?.name) {
      nameMap[config.name.toLowerCase()] = id;
      // Also map common nicknames
      if (config.name.toLowerCase() === "zackary") nameMap["zack"] = id;
    }
  }

  // Match @AgentName (case insensitive) — allow spaces and hyphens in names
  const mentionRegex = /@([A-Za-z][A-Za-z\-_ ]{0,20})/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const mentioned = match[1].trim().toLowerCase();
    if (nameMap[mentioned]) return nameMap[mentioned];
  }
  return null;
}

// Pick the best agent for a message when nobody is @mentioned
function pickAgentByContent(content: string, memberIds: string[]): string {
  const lower = content.toLowerCase();
  // Coding keywords
  const codingKw = ["code", "bug", "fix", "edit", "refactor", "deploy", "file", "github", "commit", "push", "build", "css", "ui", "component", "api", "route", "function", "typescript", "react", "next", "sidebar", "layout", "page", "style", "design", "app", "website", "frontend", "backend", "database", "error", "crash", "broken", "update", "improve", "change", "add", "create", "remove", "delete", "clean", "polish", "responsive", "mobile", "performance", "optimize"];
  if (codingKw.some(kw => lower.includes(kw))) {
    const coder = memberIds.find(id => CODER_IDS.includes(id));
    if (coder) return coder;
  }
  // Social media
  if (["social", "post", "tweet", "x.com", "twitter", "instagram", "facebook", "linkedin", "content", "trend", "hashtag", "viral"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "maya") ?? memberIds[0];
  }
  // SEO/website
  if (["seo", "google", "search ranking", "keywords", "meta tag", "sitemap"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "sally") ?? memberIds[0];
  }
  // Legal
  if (["legal", "contract", "gdpr", "privacy policy", "terms", "agreement", "compliance", "lawsuit"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "lex") ?? memberIds[0];
  }
  // Scheduling/admin
  if (["schedule", "calendar", "meeting", "appointment", "email", "reminder", "organize", "admin"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "evie") ?? memberIds[0];
  }
  // Leads/business
  if (["lead", "prospect", "client", "sales", "outreach", "business development", "pipeline"].some(kw => lower.includes(kw))) {
    return memberIds.find(id => id === "leo") ?? memberIds[0];
  }
  // Default: first member
  return memberIds[0];
}

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
  // Determine which agent(s) to call
  const mentionedIds = inScopeAgentIds;
  if (mentionedIds.length === 0) {
    sendEvent({ type: "error", message: "No agents available to respond." });
    return;
  }

  // Pick the first agent to respond
  let currentAgentId: string;
  if (replyToAgentId && allMemberIds.includes(replyToAgentId)) {
    currentAgentId = replyToAgentId;
  } else if (!isImplicitRouting && mentionedIds.length > 0) {
    // User @mentioned specific agents — start with the first one
    currentAgentId = mentionedIds[0];
  } else {
    // No mention — pick by content
    currentAgentId = pickAgentByContent(content, allMemberIds);
  }

  // Track which agents have spoken (to prevent infinite loops)
  const spokenAgents = new Set<string>();
  // Track conversation context for handoffs
  const conversationContext: { agentId: string; text: string }[] = [];
  const MAX_HANDOFFS = 3;

  for (let handoff = 0; handoff <= MAX_HANDOFFS; handoff++) {
    if (spokenAgents.has(currentAgentId)) {
      console.log(`[group] ${currentAgentId} already spoke — stopping handoff chain`);
      break;
    }
    spokenAgents.add(currentAgentId);

    const config = getAgentConfig(currentAgentId);
    if (!config) {
      console.log(`[group] No config for ${currentAgentId} — stopping`);
      break;
    }

    const isCoder = CODER_IDS.includes(currentAgentId);
    const model = getModel(isCoder ? "smart" : "cheap");
    const tools = getToolsForAgent(config.tools);

    // Set agent context for tools
    (globalThis as Record<string, unknown>).__currentAgentId = currentAgentId;

    // Build history
    const historyMessages: ModelMessage[] = recentMessages.map((m) => {
      if (m.senderType === "human") return { role: "user", content: m.content } as ModelMessage;
      return { role: "assistant", content: m.content } as ModelMessage;
    });

    // Add conversation context from previous agents in this chain
    const contextMessages: ModelMessage[] = [];
    for (const ctx of conversationContext) {
      const ctxConfig = getAgentConfig(ctx.agentId);
      contextMessages.push({
        role: "assistant",
        content: `${ctxConfig?.name ?? ctx.agentId}: ${ctx.text}`,
      } as ModelMessage);
    }

    // Build system prompt — simple, focused on ONE agent
    const memory = await loadAgentMemory(currentAgentId);
    const isCodingChat = CODER_IDS.some(id => allMemberIds.includes(id));

    // Fetch opened repos if this is a coding agent
    let reposSection = "";
    if (isCoder && isCodingChat) {
      const { data: openedRepos } = await supabase
        .from("github_repos")
        .select("owner, repo_name")
        .order("opened_at", { ascending: false });
      if (openedRepos && openedRepos.length > 0) {
        reposSection = `\n## Opened Repos\n${openedRepos.map((r: any) => `- ${r.owner}/${r.repo_name}`).join("\n")}\nOnly access repos from this list.`;
      }
    }

    // Team context — who else is available
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

## Rules
- Keep it PG-rated. No profanity, sexual content, violence, or illegal stuff.
- Be casual like Slack. Short messages.
- You can @mention another team member if you want their input. Example: "Let me check with @Zack on the architecture side."
- Only @mention someone if you genuinely need their input. Don't just pass the buck.
- If you can answer yourself, just answer. Don't @mention unnecessarily.
${isCoder ? `
## Code Tools
You have REAL GitHub tools. CALL them — don't write tool names as text.
- First: briefly say what you're going to do (1-2 sentences)
- Then: call tools to read and edit files
- Then: report what you actually did
- Read files with github_read_file, edit with github_edit_file (content = FULL file)
- github_edit_file pushes to GitHub → Netlify auto-builds. No deploy tool needed.
- Broad tasks = edit MULTIPLE files. One edit is not done. Keep going.
- No placeholder content. No new dependencies. Read before editing.` : `
## Tools
Only use tools when the user EXPLICITLY asks for something that needs one. Don't use tools proactively.`}

## Continue
If the user says "continue", look at history and keep doing what you were doing.`;

    // Build the user message
    let userMessage = content;
    let isAutoContinue = false;

    if (handoff > 0 && conversationContext.length > 0) {
      const lastContext = conversationContext[conversationContext.length - 1];
      const lastConfig = getAgentConfig(lastContext.agentId);

      if (lastContext.agentId === currentAgentId) {
        // Same agent continuing — auto-continue
        isAutoContinue = true;
        userMessage = `continue — keep going with what you were doing. You were working on: "${content}". Your last message was: "${lastContext.text}". Keep going.`;
      } else {
        // Different agent — handoff
        userMessage = `${lastConfig?.name ?? lastContext.agentId} said: "${lastContext.text}"\n\nThey mentioned you. Can you weigh in on this? Original request from user: "${content}"`;
      }
    }

    try {
      sendEvent({ type: "agent_start", agentId: currentAgentId });

      const result = streamText({
        model,
        system: systemPrompt,
        messages: [
          ...historyMessages.slice(-10, -1),
          ...contextMessages.slice(-3),
          { role: "user", content: userMessage } as ModelMessage,
        ],
        tools,
        stopWhen: isStepCount(isCoder ? 50 : 10),
      });

      let fullText = "";
      const toolCalls: { tool: string; args: Record<string, unknown>; result?: unknown; error?: string }[] = [];

      // Stream directly — no buffer, no markers, no parser
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          const delta = (part as { text: string }).text;
          fullText += delta;
          sendEvent({ type: "token", agentId: currentAgentId, text: delta });
        } else if (part.type === "tool-call") {
          const toolName = (part as { toolName: string }).toolName;
          const toolInput = (part as { input: unknown }).input;
          sendEvent({ type: "tool_call", agentId: currentAgentId, tool: toolName, args: toolInput });
          sendEvent({ type: "heartbeat", tool: toolName });
          toolCalls.push({ tool: toolName, args: toolInput as Record<string, unknown> });
        } else if (part.type === "tool-result") {
          const toolName = (part as { toolName: string }).toolName;
          const output = (part as { output: unknown }).output;
          const error = (output as { error?: string })?.error;
          const pending = toolCalls.find(tc => tc.tool === toolName && tc.result === undefined);
          if (pending) {
            pending.result = output;
            pending.error = error;
          }
          sendEvent({ type: "tool_result", agentId: currentAgentId, tool: toolName, result: output, error });
          sendEvent({ type: "heartbeat", tool: toolName, result: "done" });
        }
      }
      markModelSuccess();

      // Log API usage
      try {
        const usage = await result.totalUsage;
        logApiUsage({
          model: getModelName(isCoder ? "smart" : "cheap"),
          tier: isCoder ? "smart" : "cheap",
          agentId: currentAgentId,
          chatId,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          toolCalls: toolCalls.length,
        });
      } catch { /* ignore */ }

      // Save the agent's message
      const trimmed = fullText.trim();
      if (trimmed) {
        const agentMessageId = nanoid();
        await supabase.from("messages").insert({
          id: agentMessageId,
          chat_id: chatId,
          sender_id: currentAgentId,
          sender_type: "agent",
          content: trimmed,
          mentions: [],
          tool_calls: toolCalls,
        });
        sendEvent({ type: "message_end", agentId: currentAgentId, messageId: agentMessageId, content: trimmed });

        // Track for handoff context
        conversationContext.push({ agentId: currentAgentId, text: trimmed });

        // ─── Auto-continue for coders ───
        // If a coder did tool calls but the response seems incomplete
        // (didn't mention "done", "complete", "finished", or still has work to do),
        // automatically continue with another call
        if (isCoder && toolCalls.length > 0 && handoff < MAX_HANDOFFS) {
          const completionWords = ["done", "complete", "finished", "all set", "that's it", "nothing more", "wrapped up", "pushed", "deployed"];
          const looksComplete = completionWords.some(w => trimmed.toLowerCase().includes(w));
          const hasMoreWork = trimmed.toLowerCase().includes("still need") || trimmed.toLowerCase().includes("next step") || trimmed.toLowerCase().includes("more to do") || trimmed.toLowerCase().includes("continue");

          if (!looksComplete || hasMoreWork) {
            console.log(`[group] Auto-continue for ${currentAgentId} — response seems incomplete (${toolCalls.length} tool calls, looksComplete=${looksComplete})`);
            // Don't add to spokenAgents so the same agent can continue
            spokenAgents.delete(currentAgentId);
            // Update content to "continue" for the next iteration
            // We'll use a special flag instead
            handoff++;
            // Keep the same agent, just continue
            continue;
          }
        }

        // Check if this agent @mentioned another agent
        const nextAgent = detectMention(trimmed, allMemberIds);
        console.log(`[group] ${currentAgentId} response (${trimmed.length} chars). Mention detected: ${nextAgent ?? "none"}. Handoff ${handoff}/${MAX_HANDOFFS}`);
        if (nextAgent && !spokenAgents.has(nextAgent) && handoff < MAX_HANDOFFS) {
          console.log(`[group] ${currentAgentId} mentioned ${nextAgent} — handing off`);
          // Small delay for natural feel
          await new Promise(r => setTimeout(r, 500));
          currentAgentId = nextAgent;
          continue;
        }
      }

      // No handoff — we're done
      break;
    } catch (err) {
      if (isRateLimitError(err) || isModelError(err)) {
        advanceFallbackModel(isCoder ? "smart" : "cheap");
        sendEvent({ type: "error", message: `Model error. Try sending again.` });
      } else {
        sendEvent({
          type: "error",
          message: `${config.name} failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        });
      }
      break;
    } finally {
      delete (globalThis as Record<string, unknown>).__currentAgentId;
    }
  }
}
