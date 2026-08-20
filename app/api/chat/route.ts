import { NextRequest } from "next/server";
import { supabase } from "@/db/client";
import type { Chat, ChatMember, Message } from "@/db/schema-types";
import { getModel, advanceFallbackModel, isRateLimitError, isModelError, markModelSuccess } from "@/lib/llm";
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

${isCoder ? `## Tool Usage — BE AUTONOMOUS
You are a coder. You have tools to read, edit, and deploy code. USE THEM.
- When the user asks you to fix something: READ the file, EDIT it, and REPORT what you changed. Don't suggest — DO.
- When the user asks you to review code: USE github_review tool, then FIX the issues you find.
- When the user asks you to deploy: just call github_edit_file — it pushes to GitHub and Netlify auto-builds. Use netlify_list_deploys to check if it succeeded.
- Never say "I suggest..." or "You should..." — just make the change. The user can reject it if they don't like it.
- Read files before editing. Edit files directly. That's the job.
- BROAD TASKS: If the user says "make the website better" or "improve everything" or "fix all bugs," that means MULTIPLE files. Read all relevant files, then edit ALL of them. One edit is NOT done. Keep going until the task is complete or you run out of steps.
- NO PLACEHOLDER CONTENT. Never create a file that says "This page will..." or "Coming soon" or "TODO." Every file you create must be FULLY FUNCTIONAL with real components, real styling, real logic.
- github_edit_file requires the FULL file content, not a diff. Output the entire file.
- NEVER write tool names as text. CALL the tool. Writing "github_edit_file: fixing..." does NOTHING.
- If the user says "continue", keep doing whatever you were doing. Don't ask "continue with what?" — look at the conversation history and keep going.` : `## Tool Usage Rules
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

    for await (const delta of result.textStream) {
      fullText += delta;
      sendEvent({ type: "token", agentId, text: delta });
    }
    markModelSuccess();

    const toolCallResults = await result.toolCalls;
    const toolResultData = await result.toolResults;

    for (let i = 0; i < toolCallResults.length; i++) {
      const tc = toolCallResults[i] as { toolName: string; input: unknown };
      const toolName = String(tc.toolName);
      const args = tc.input as Record<string, unknown>;
      sendEvent({ type: "tool_call", agentId, tool: toolName, args });
      const tr = toolResultData[i] as { output: unknown } | undefined;
      if (tr) {
        const resultData = tr.output as unknown;
        const error = (resultData as { error?: string })?.error;
        sendEvent({ type: "tool_result", agentId, tool: toolName, result: resultData, error });
        toolCalls.push({ tool: toolName, args, result: resultData, error });
      } else {
        toolCalls.push({ tool: toolName, args });
      }
    }

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

// ─── Group handler: ONE call for all agents ───
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
  // Reorder: if replying to someone, put them first
  let orderedIds = inScopeAgentIds;
  if (replyToAgentId && inScopeAgentIds.includes(replyToAgentId)) {
    orderedIds = [replyToAgentId, ...inScopeAgentIds.filter((id) => id !== replyToAgentId)];
  }

  const configs = orderedIds.map((id) => getAgentConfig(id)).filter(Boolean);
  if (configs.length === 0) return;

  // ─── SMART AGENT FILTERING ───
  // Only include agents relevant to the message. This prevents non-coders
  // from chiming in on coding tasks, etc. No rules needed — if an agent
  // isn't in the prompt, they can't respond.
  const isCodingTeam = chatId === "group-coding-team" || chatId === "coding-team";
  const isAllTeam = chatId === "group-all-team" || chatId === "all-team";

  const coderIds = ["zack", "kevin", "beepbop"];
  const nonCoderIds = ["maya", "leo", "sally", "evie", "lex"];

  // Detect if this is a coding-related message
  const lowerContent = content.toLowerCase();
  const codingKeywords = ["code", "bug", "fix", "edit", "refactor", "deploy", "file", "github", "commit", "push", "build", "css", "ui", "component", "api", "route", "function", "typescript", "react", "next", "sidebar", "layout", "page", "style", "design", "glassmorphism", "app", "website", "frontend", "backend", "database", "supabase", "netlify", "tool", "error", "crash", "glitch", "broken", "update", "upgrade", "improve", "change", "add", "create", "remove", "delete", "clean", "polish", "responsive", "mobile", "performance", "optimize", "seo"];
  const isCodingMessage = codingKeywords.some(kw => lowerContent.includes(kw));

  // Filter agents based on message type
  let activeAgentIds: string[];
  if (isCodingTeam) {
    // Coding team chat — only coders, but filter by who's in scope
    activeAgentIds = orderedIds.filter(id => coderIds.includes(id));
  } else if (isAllTeam) {
    // All Team — if coding message, only coders. Otherwise include all in-scope.
    if (isCodingMessage) {
      activeAgentIds = orderedIds.filter(id => coderIds.includes(id));
    } else {
      // Non-coding message in All Team — include non-coders, exclude coders
      // unless message explicitly mentions them
      const mentionsCoder = coderIds.some(id => lowerContent.includes(id) || lowerContent.includes(getAgentConfig(id)?.name?.toLowerCase() ?? ""));
      if (mentionsCoder) {
        activeAgentIds = orderedIds;
      } else {
        activeAgentIds = orderedIds.filter(id => !coderIds.includes(id) || nonCoderIds.length === 0);
        // If no non-coders in scope, fall back to all
        if (activeAgentIds.length === 0) activeAgentIds = orderedIds;
      }
    }
  } else {
    // Custom group — use all in-scope agents
    activeAgentIds = orderedIds;
  }

  // If reply-to is set, make sure that agent is included
  if (replyToAgentId && !activeAgentIds.includes(replyToAgentId)) {
    activeAgentIds = [replyToAgentId, ...activeAgentIds];
  }

  // If filtering removed everyone, fall back to original
  if (activeAgentIds.length === 0) activeAgentIds = orderedIds;

  // Use filtered agents for the prompt
  const activeConfigs = activeAgentIds.map((id) => getAgentConfig(id)).filter(Boolean);
  if (activeConfigs.length === 0) return;

  const agentRoster = activeConfigs.map((c) => `- ${c!.name} (${c!.id}): ${c!.role}`).join("\n");

  const personaSections = activeConfigs.map((c) =>
    `### ${c!.name} (id: ${c!.id})\n${c!.persona}`
  ).join("\n\n");

  // Load memories for active agents only
  const memorySections = await Promise.all(
    activeConfigs.map((c) => loadAgentMemory(c!.id))
  );
  const memoryBlock = memorySections.filter(Boolean).length > 0
    ? `\n## Memories\n${memorySections.filter(Boolean).join("\n")}`
    : "";

  // Fetch opened repos for coding agents
  let openedReposList = "";
  const hasCoders = activeAgentIds.some(id => coderIds.includes(id));
  if (hasCoders) {
    const { data: openedRepos } = await supabase
      .from("github_repos")
      .select("owner, repo_name")
      .order("opened_at", { ascending: false });
    if (openedRepos && openedRepos.length > 0) {
      openedReposList = openedRepos.map((r: any) => `- ${r.owner}/${r.repo_name}`).join("\n");
    }
  }

  const replyContext = replyToAgentId
    ? `\nThe user is replying to ${getAgentConfig(replyToAgentId)?.name ?? "someone"}. That agent responds first.`
    : "";

  // ─── Clean, short system prompt ───
  const systemPrompt = `You are a team of AI assistants in a group chat. Respond as the agents below.

## Agents
${agentRoster}

## Personas
${personaSections}
${memoryBlock}

## Rules
- Keep it PG-rated. No profanity, sexual content, violence, or illegal stuff.
- Be casual like Slack. Short messages.
- Format: start each agent's message with [agent_id] in brackets.
- Only agents listed above can respond. If you're not listed, don't respond.
- One agent responds unless another has something real to add.
- Don't respond just to agree or praise. Silence > noise.
- If using tools, still produce a text response with [agent_id] markers after.${replyContext}

${hasCoders ? `## Code Tools
You have REAL GitHub tools. CALL them — don't write tool names as text.

Opened repos:
${openedReposList || "(none — tell user to open repos on the Repos page)"}

How to work:
1. Read files with github_read_file (do all reads in one step)
2. Edit files with github_edit_file (content = FULL file, not a diff)
3. Report what you did with [agent_id] markers

Rules:
- DO the work, then report. Don't announce, don't suggest, don't plan — just do it.
- github_edit_file pushes to GitHub → Netlify auto-builds. No deploy tool needed.
- Broad tasks = edit MULTIPLE files. One edit is not done. Keep going.
- No placeholder content. Every file must be fully functional.
- No new dependencies. Use only installed packages.
- Read before editing. Always.
- You have 50 steps. Use them.` : ''}

## Continue
If the user says "continue", look at history and keep doing what you were doing. Don't ask "continue with what?"`;

  // Build history
  const historyMessages: ModelMessage[] = recentMessages.map((m) => {
    if (m.senderType === "human") return { role: "user", content: m.content } as ModelMessage;
    const agent = getAgentConfig(m.senderId);
    return { role: "assistant", content: `${agent?.name ?? "Agent"}: ${m.content}` } as ModelMessage;
  });

  // Add other team members context
  const otherMembers = allMemberIds
    .filter((id) => !inScopeAgentIds.includes(id))
    .map((id) => getAgentConfig(id))
    .filter(Boolean)
    .map((a) => `${a!.name} (${a!.role})`);

  const userMessage = otherMembers.length > 0
    ? `${content}\n\n[Also in this chat but not asked to respond: ${otherMembers.join(", ")}]`
    : content;

  try {
    const model = getModel(hasCoders ? "smart" : "cheap");

    // All agents get their full toolset in every chat
    const allToolNames = new Set<string>();
    for (const config of configs) {
      for (const tool of config!.tools) {
        allToolNames.add(tool);
      }
    }
    const groupTools = getToolsForAgent(Array.from(allToolNames));

    // Give agents tools in the main call so they can actually DO work
    // Heartbeats during tool calls keep the Netlify connection alive
    const hasTools = hasCoders;
    // Set agent context for tools (use first coder if available, else first in-scope)
    const primaryAgentId = activeAgentIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? activeAgentIds[0];
    (globalThis as Record<string, unknown>).__currentAgentId = primaryAgentId;
    const result = streamText({
      model,
      system: systemPrompt,
      messages: [
        ...historyMessages.slice(-12, -1),
        { role: "user", content: userMessage } as ModelMessage,
      ],
      tools: hasTools ? groupTools : undefined,
      stopWhen: isStepCount(hasTools ? 50 : 1),
      maxOutputTokens: hasTools ? 24000 : undefined,
    });

    // ─── Parse the stream for [agent_id] markers ───
    // Use fullStream to get tool call events as they happen (keeps connection alive)
    let fullText = "";
    let currentAgentId: string | null = null;
    let currentAgentText = "";
    let buffer = "";
    let agentIndex = 0;
    const agentResponses: Record<string, string> = {};
    const agentToolCallMap: Record<string, { tool: string; args: Record<string, unknown>; result?: unknown; error?: string }[]> = {};
    let retryUsed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let retryResult: any = null;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Clean markers from text that will be shown to user
    function cleanMarkers(text: string): string {
      return text
        .replace(/\*?\*?\[\w+\]\*?\*?\s*/g, "")
        .replace(/@@agent:\w+/g, "")
        .replace(/@@end/g, "")
        .replace(/@@action:\w+\([^)]*\)/g, "") // Strip @@action:tool(...)
        .replace(/\/\w+\([^)]*\)/g, "") // Strip /tool(...)
        .replace(/:\w+\([^)]*\)/g, "") // Strip :tool(...)
        .replace(/@@\w+/g, "") // Strip any other @@ markers
        .replace(/^\s*\n?/, "");
    }

    // Known agent IDs for validation
    const knownAgentIds = new Set(activeAgentIds);

    // Fallback: if model produces text without [agent_id] markers, use first agent
    let fallbackAgentUsed = false;

    // Stream text and tool calls — heartbeats keep Netlify alive during tool execution
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        const delta = (part as { text: string }).text;
        fullText += delta;
        buffer += delta;
      } else if (part.type === "tool-call") {
        // Send real tool call event + heartbeat to keep connection alive
        const toolName = (part as { toolName: string }).toolName;
        const toolInput = (part as { input: unknown }).input;
        // Attribute to the agent currently speaking, or the first in-scope agent
        let toolAgentId = currentAgentId ?? activeAgentIds[0] ?? "system";
        // If no agent is currently speaking, try to infer from tool type
        if (!currentAgentId) {
          const codeTools = ["github_edit_file", "github_read_file", "github_list_files", "github_list_repos", "github_delete_file", "github_get_commits", "github_review", "github_create_branch", "github_create_pr", "github_create_issue", "github_search_code", "github_list_branches", "netlify_list_deploys"];
          if (codeTools.includes(toolName)) {
            toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? activeAgentIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
          } else {
            // Find an agent that has this tool
            const agentWithTool = activeAgentIds.find(id => {
              const config = getAgentConfig(id);
              return config?.tools.includes(toolName);
            });
            if (agentWithTool) toolAgentId = agentWithTool;
          }
        }
        // Track tool call per agent for persistence
        if (!agentToolCallMap[toolAgentId]) agentToolCallMap[toolAgentId] = [];
        agentToolCallMap[toolAgentId].push({ tool: toolName, args: toolInput as Record<string, unknown> });
        sendEvent({ type: "tool_call", agentId: toolAgentId, tool: toolName, args: toolInput });
        sendEvent({ type: "heartbeat", tool: toolName });
      } else if (part.type === "tool-result") {
        const toolName = (part as { toolName: string }).toolName;
        const output = (part as { output: unknown }).output;
        let toolAgentId = currentAgentId ?? activeAgentIds[0] ?? "system";
        if (!currentAgentId) {
          const codeTools = ["github_edit_file", "github_read_file", "github_list_files", "github_list_repos", "github_delete_file", "github_get_commits", "github_review", "github_create_branch", "github_create_pr", "github_create_issue", "github_search_code", "github_list_branches", "netlify_list_deploys"];
          if (codeTools.includes(toolName)) {
            toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? activeAgentIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
          } else {
            const agentWithTool = activeAgentIds.find(id => {
              const config = getAgentConfig(id);
              return config?.tools.includes(toolName);
            });
            if (agentWithTool) toolAgentId = agentWithTool;
          }
        }
        const error = (output as { error?: string })?.error;
        // Update the tracked tool call with its result
        if (agentToolCallMap[toolAgentId]) {
          const pending = agentToolCallMap[toolAgentId].find(tc => tc.tool === toolName && tc.result === undefined);
          if (pending) {
            pending.result = output;
            pending.error = error;
          }
        }
        sendEvent({ type: "tool_result", agentId: toolAgentId, tool: toolName, result: output, error });
        sendEvent({ type: "heartbeat", tool: toolName, result: "done" });
      }

      // Process buffer for [agent_id] markers
      while (true) {
        if (currentAgentId === null) {
          // Looking for [agent_id] marker
          const match = buffer.match(/\[(\w+)\]/);
          if (match && knownAgentIds.has(match[1])) {
            const idx = buffer.indexOf(match[0]);
            buffer = buffer.slice(idx + match[0].length);
            currentAgentId = match[1];
            buffer = buffer.replace(/^\s*\n?/, "");
            currentAgentText = "";

            // Typing delay
            const startDelay = agentIndex === 0 ? 400 : 800 + Math.random() * 600;
            await sleep(startDelay);

            sendEvent({ type: "agent_start", agentId: currentAgentId });
            agentIndex++;
          } else if (buffer.match(/\[(\w+)\]/)) {
            // Found a bracket but not a known agent — skip past it
            const match = buffer.match(/\[(\w+)\]/)!;
            const idx = buffer.indexOf(match[0]);
            buffer = buffer.slice(idx + match[0].length);
          } else {
            // No marker found — if buffer is long enough, try to detect agent by name
            if (buffer.length > 50 && !fallbackAgentUsed) {
              // Check if the text starts with an agent name like "Zack:" or "Maya:"
              const nameMatch = buffer.match(/^(?:\*?\*?)?(Zack|Maya|Leo|Sally|Evie|Lex|Kevin|Beepbop)\s*[:\-]/i);
              if (nameMatch) {
                const detectedId = nameMatch[1].toLowerCase();
                if (knownAgentIds.has(detectedId)) {
                  // Strip the name prefix from the buffer
                  buffer = buffer.slice(nameMatch[0].length).replace(/^\s+/, "");
                  currentAgentId = detectedId;
                } else {
                  currentAgentId = activeAgentIds[0];
                }
              } else {
                currentAgentId = activeAgentIds[0];
              }
              fallbackAgentUsed = true;
              currentAgentText = "";
              const startDelay = agentIndex === 0 ? 400 : 800 + Math.random() * 600;
              await sleep(startDelay);
              sendEvent({ type: "agent_start", agentId: currentAgentId });
              agentIndex++;
              // Don't break — continue with this agent
            } else {
              if (buffer.length > 30) {
                buffer = buffer.slice(-30);
              }
              break;
            }
          }
        } else {
          // Inside an agent block — check for a new [agent_id] marker
          const match = buffer.match(/\[(\w+)\]/);
          const newAgentIdx = match && knownAgentIds.has(match[1]) ? buffer.indexOf(match[0]) : -1;

          if (newAgentIdx !== -1) {
            // Found a new [agent_id] — flush current agent
            const textToSend = buffer.slice(0, newAgentIdx);
            if (textToSend) {
              const cleaned = cleanMarkers(textToSend);
              if (cleaned) {
                currentAgentText += cleaned;
                const chunks = cleaned.match(/.{1,8}/g) ?? [cleaned];
                for (const chunk of chunks) {
                  sendEvent({ type: "token", agentId: currentAgentId, text: chunk });
                  await sleep(20 + Math.random() * 40);
                }
              }
            }

            await finalizeAgent(currentAgentId, currentAgentText, chatId, sendEvent, agentResponses, agentToolCallMap[currentAgentId]);
            currentAgentId = null;
            currentAgentText = "";
            // Don't slice buffer — the [agent_id] is still there for the next iteration
          } else {
            // No new agent marker found, send safe portion
            const safeLength = buffer.length - 15;
            if (safeLength > 0) {
              let textToSend = buffer.slice(0, safeLength);
              textToSend = cleanMarkers(textToSend);
              if (textToSend) {
                currentAgentText += textToSend;
                sendEvent({ type: "token", agentId: currentAgentId, text: textToSend });
              }
              buffer = buffer.slice(safeLength);
            }
            break;
          }
        }
      }
    }

    // Flush remaining buffer
    if (currentAgentId && buffer) {
      const cleaned = cleanMarkers(buffer).trim();
      if (cleaned) {
        currentAgentText += cleaned;
        sendEvent({ type: "token", agentId: currentAgentId, text: cleaned });
      }
      await finalizeAgent(currentAgentId, currentAgentText, chatId, sendEvent, agentResponses, agentToolCallMap[currentAgentId]);
    }

    // If no agents responded with markers, try a fallback
    if (!fullText.match(/\[\w+\]/) || !activeAgentIds.some((id) => fullText.includes(`[${id}]`))) {
      // Check if tool calls actually happened — if so, the model worked but just didn't format text
      let toolCallsHappened = false;
      let toolCallSummary = "";
      try {
        const firstToolCalls = await result.toolCalls;
        toolCallsHappened = !!(firstToolCalls && firstToolCalls.length > 0);
        if (toolCallsHappened) {
          toolCallSummary = "\n\n[Tool calls already completed:\n" + firstToolCalls.map((tc: { toolName: string; input: unknown }) =>
            `- ${tc.toolName}(${JSON.stringify(tc.input).slice(0, 300)})`
          ).join("\n") + "\n]";
        }
      } catch { /* ignore */ }

      // If tool calls happened, DON'T advance the fallback model — the model worked, it just didn't produce text markers
      if (!toolCallsHappened) {
        advanceFallbackModel(hasCoders ? "smart" : "cheap");
      }

      try {
        const fallbackModel = getModel(hasCoders ? "smart" : "cheap");

        // Retry WITHOUT tools so the model just produces text immediately
        const retryUserMessage = toolCallSummary
          ? `${userMessage}\n\n${toolCallSummary}\n\nNow report what you did. Each agent that responds MUST start with [agent_id] in brackets, then their message. Example: [zack] I read the files and found 3 bugs.`
          : `${userMessage}\n\nRespond now. Each agent MUST start with [agent_id] in brackets. Example: [zack] Here's what I found.`;

        retryResult = streamText({
          model: fallbackModel,
          system: systemPrompt + "\n\nCRITICAL: You MUST respond with [agent_id] markers. Start each agent's message with [agent_id] in brackets. Example:\n[zack] I read the files and found 3 bugs.\n\nDO NOT skip the [agent_id] markers. DO NOT respond without them.",
          messages: [
            ...historyMessages.slice(-12, -1),
            { role: "user", content: retryUserMessage } as ModelMessage,
          ],
          // No tools in retry — just generate text
          stopWhen: isStepCount(1),
          maxOutputTokens: hasCoders ? 8000 : 4000,
        });

        let retryText = "";
        for await (const delta of retryResult.textStream) {
          retryText += delta;
        }

        // Check if fallback produced valid agent markers
        const hasValidMarkers = activeAgentIds.some((id) =>
          retryText.includes(`[${id}]`)
        );
        console.log("[chat] Retry text length:", retryText.length, "hasValidMarkers:", hasValidMarkers);

        if (hasValidMarkers) {
          fullText = retryText;
          retryUsed = true;
          // Parse the simple format
          const lines = retryText.split("\n");
          let retryAgentId: string | null = null;
          let retryAgentText = "";

          for (const line of lines) {
            const match = line.match(/^\[(\w+)\]\s*(.*)/);
            if (match && knownAgentIds.has(match[1])) {
              // New agent — flush previous
              if (retryAgentId && retryAgentText) {
                sendEvent({ type: "agent_start", agentId: retryAgentId });
                sendEvent({ type: "token", agentId: retryAgentId, text: retryAgentText });
                await finalizeAgent(retryAgentId, retryAgentText, chatId, sendEvent, agentResponses, agentToolCallMap[retryAgentId]);
              }
              retryAgentId = match[1];
              retryAgentText = cleanMarkers(match[2]);
            } else if (retryAgentId) {
              retryAgentText += "\n" + cleanMarkers(line);
            }
          }
          // Flush last
          if (retryAgentId && retryAgentText) {
            sendEvent({ type: "agent_start", agentId: retryAgentId });
            sendEvent({ type: "token", agentId: retryAgentId, text: retryAgentText });
            await finalizeAgent(retryAgentId, retryAgentText, chatId, sendEvent, agentResponses, agentToolCallMap[retryAgentId]);
          }
        } else if (retryText.trim()) {
          // No markers found but there IS text — send as the primary agent
          const fallbackAgentId = hasCoders
            ? activeAgentIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? activeAgentIds[0]
            : activeAgentIds[0];
          if (fallbackAgentId) {
            // Strip any fake markers from the text
            const cleanText = retryText.replace(/^\*?\*?\[\w+\]\*?\*?\s*/, "").trim();
            sendEvent({ type: "agent_start", agentId: fallbackAgentId });
            sendEvent({ type: "token", agentId: fallbackAgentId, text: cleanText });
            await finalizeAgent(fallbackAgentId, cleanText, chatId, sendEvent, agentResponses, agentToolCallMap[fallbackAgentId]);
          }
        } else if (toolCallsHappened) {
          // Tool calls happened but retry produced nothing — generate a basic summary
          const fallbackAgentId = hasCoders
            ? activeAgentIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? activeAgentIds[0]
            : activeAgentIds[0];
          if (fallbackAgentId) {
            const summary = `I ran some tools but didn't produce a summary. Check the tool call results above to see what I did.`;
            sendEvent({ type: "agent_start", agentId: fallbackAgentId });
            sendEvent({ type: "token", agentId: fallbackAgentId, text: summary });
            await finalizeAgent(fallbackAgentId, summary, chatId, sendEvent, agentResponses, agentToolCallMap[fallbackAgentId]);
          }
        } else {
          sendEvent({
            type: "error",
            message: `No response generated. Try sending again.`,
          });
        }
      } catch (retryErr) {
        if (isRateLimitError(retryErr)) {
          advanceFallbackModel(hasCoders ? "smart" : "cheap");
        }
        sendEvent({
          type: "error",
          message: "No one on the team responded. Try @mentioning a specific person.",
        });
      }
    }

    // ─── Emit tool calls from group mode ───
    // Use retryResult if the fallback was used, otherwise use the original result
    const toolSource = retryUsed && retryResult ? retryResult : result;
    if (groupTools && toolSource) {
      const toolCallResults = await toolSource.toolCalls;
      const toolResultData = await toolSource.toolResults;
      for (let i = 0; i < toolCallResults.length; i++) {
        const tc = toolCallResults[i] as { toolName: string; input: unknown };
        const toolName = String(tc.toolName);
        const args = tc.input as Record<string, unknown>;

        // Attribute tool calls to the agent that most likely made them
        let toolAgentId = inScopeAgentIds[0] ?? "system";
        // Code tools go to whichever coder responded
        if (["github_edit_file", "github_review", "github_read_file", "github_list_files", "github_list_repos", "github_delete_file", "github_get_commits", "github_create_branch", "github_create_pr", "github_create_issue", "github_search_code", "github_list_branches", "netlify_list_deploys"].includes(toolName)) {
          toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? inScopeAgentIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
        }
        // Other tools go to whichever agent responded that has that tool
        else {
          const agentWithTool = Object.keys(agentResponses).find(id => {
            const config = getAgentConfig(id);
            return config?.tools.includes(toolName);
          });
          if (agentWithTool) toolAgentId = agentWithTool;
        }

        sendEvent({ type: "tool_call", agentId: toolAgentId, tool: toolName, args });
        const tr = toolResultData[i] as { output: unknown } | undefined;
        if (tr) {
          const resultData = tr.output as unknown;
          const error = (resultData as { error?: string })?.error;
          sendEvent({ type: "tool_result", agentId: toolAgentId, tool: toolName, result: resultData, error });
        }
      }
    }

  } catch (err) {
    if (isRateLimitError(err) || isModelError(err)) {
      advanceFallbackModel(hasCoders ? "smart" : "cheap");
      sendEvent({ type: "error", message: `Model error, switched to fallback. Try sending again.` });
    } else {
      sendEvent({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  } finally {
    delete (globalThis as Record<string, unknown>).__currentAgentId;
  }
}

async function finalizeAgent(
  agentId: string,
  text: string,
  chatId: string,
  sendEvent: (e: Record<string, unknown>) => void,
  agentResponses?: Record<string, string>,
  agentToolCalls?: { tool: string; args: Record<string, unknown>; result?: unknown; error?: string }[],
) {
  // Final cleanup of any leaked markers
  const trimmed = text
    .replace(/\*?\*?\[\w+\]\*?\*?\s*/g, "")
    .replace(/@@agent:\w+/g, "")
    .replace(/@@end/g, "")
    .trim();
  if (!trimmed) return;

  // Check for skip
  if (trimmed === "[SKIP]" || trimmed.toLowerCase() === "[skip]") {
    const config = getAgentConfig(agentId);
    sendEvent({ type: "agent_skip", agentId, name: config?.name ?? agentId });
    return;
  }

  // Track response for follow-up tool calls
  if (agentResponses) {
    agentResponses[agentId] = trimmed;
  }

  const agentMessageId = nanoid();
  await supabase.from("messages").insert({
    id: agentMessageId,
    chat_id: chatId,
    sender_id: agentId,
    sender_type: "agent",
    content: trimmed,
    mentions: [],
    tool_calls: agentToolCalls ?? [],
  });

  sendEvent({ type: "message_end", agentId, messageId: agentMessageId, content: trimmed });
}
