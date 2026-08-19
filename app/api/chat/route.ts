import { NextRequest } from "next/server";
import { supabase } from "@/db/client";
import type { Chat, ChatMember, Message } from "@/db/schema-types";
import { getModel, advanceFallbackModel, isRateLimitError, markModelSuccess } from "@/lib/llm";
import { getAgentConfig } from "@/agents/config";
import { getToolsForAgent } from "@/lib/tools";
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
          advanceFallbackModel();
          sendEvent({ type: "error", message: `Rate limited on current model. Switched to fallback. Try sending again.` });
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

  (globalThis as Record<string, unknown>).__currentAgentId = agentId;
  sendEvent({ type: "agent_start", agentId });

  const historyMessages: ModelMessage[] = recentMessages.map((m) => {
    if (m.senderType === "human") return { role: "user", content: m.content } as ModelMessage;
    const agent = getAgentConfig(m.senderId);
    return { role: "assistant", content: m.content } as ModelMessage;
  });

  const tools = getToolsForAgent(config.tools);

  try {
    const model = getModel(config.model);
    const isCoder = ["zack", "kevin", "beepbop"].includes(agentId);
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
- When the user asks you to review code: USE code_review tool, then FIX the issues you find.
- When the user asks you to deploy: USE netlify_deploy to push to the live site.
- Never say "I suggest..." or "You should..." — just make the change. The user can reject it if they don't like it.
- Read files before editing. Edit files directly. Deploy when asked. That's the job.
- If the user says "continue", keep doing whatever you were doing. Don't ask "continue with what?" — look at the conversation history and keep going.` : `## Tool Usage Rules
You have access to tools but you MUST NOT use them proactively. Only use a tool when:
1. The user EXPLICITLY asks you to do something that requires a tool (e.g. "send an email", "search for X", "post to social media", "create a reminder")
2. The user asks you to do a specific task that can only be completed with a tool

Do NOT use tools just because they're available. Do NOT send emails, search the web, post to social media, create reminders, or take any action unless the user specifically asks you to. If the user is just chatting or asking for advice, just respond with text — no tools.

If you're unsure whether the user wants you to take action, ASK them first instead of using a tool.`}`;

    const result = streamText({
      model,
      system: config.persona + toolInstructions,
      messages: [...historyMessages.slice(0, -1), { role: "user", content } as ModelMessage],
      tools,
      stopWhen: isStepCount(isCoder ? 12 : 8),
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
    if (isRateLimitError(err)) {
      advanceFallbackModel();
      sendEvent({ type: "error", message: `Rate limited on current model. Switched to fallback. Try sending again.` });
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

  // Build the combined system prompt with all agent personas
  const agentRoster = configs.map((c) => `- ${c!.name} (${c!.id}): ${c!.role}`).join("\n");

  const personaSections = configs.map((c) =>
    `### ${c!.name} (id: ${c!.id})\nRole: ${c!.role}\nPersonality: ${c!.persona}`
  ).join("\n\n");

  const routingRule = isImplicitRouting
    ? `The user did not address anyone specifically. Each agent should ONLY respond if:
1. The message is relevant to their job/role, OR
2. They disagree with or want to add to what another agent said, OR
3. It's a casual greeting — but keep it SHORT and casual ("hey", "hi boss", "yo"). Do NOT introduce yourself or explain your job. If 2+ agents already greeted, skip.

If an agent has nothing to add, simply don't include them. Not everyone needs to speak.`
    : `The user specifically addressed certain agents. Those agents should respond first. Others can chime in only if they have something important to add.`;

  const replyContext = replyToAgentId
    ? `\n\nIMPORTANT: The user is replying to ${getAgentConfig(replyToAgentId)?.name ?? "someone"}. That agent should respond FIRST.`
    : "";

  const isCodingTeam = chatId === "coding-team";
  const isAllTeam = chatId === "all-team";

  const systemPrompt = `You are a team of AI assistants in a group chat. You will respond as multiple agents in a single response.

## Team Members
${agentRoster}

## Agent Personas
${personaSections}

## Safety & Content Rules
ALL agents MUST keep responses PG-rated and family-friendly at ALL times:
- No sexual content, innuendo, or explicit material
- No profanity, slurs, or offensive language
- No violence, self-harm, or dangerous content
- No hate speech, harassment, or discrimination
- No drug promotion (Beepbop's energy drink/vape is a comedic character trait only — never glorify or promote real substance use)
- No illegal activity or instructions
- If the user asks for any of the above, the responding agent should politely decline and redirect
- Stay professional and appropriate even if provoked

## Response Format — SIMPLE
Each agent that responds MUST use this format:

[agent_id] their message here

Example:
[maya] hey, that trend is fire, let me draft a post
[sage] I can add SEO keywords to that post too

Rules:
- Start each agent's message with [agent_id] in brackets, then their text
- One agent per block. Keep messages short like Slack.
- Only include agents that have something to say
- Agents can talk to each other
- Be casual, not corporate
- If using tools, STILL produce a text response with [agent_id] markers after${replyContext}

## Routing
${routingRule}

## Team Dynamics
- Agents can talk to each other, not just to the user. If Maya suggests a post, Sage might chime in about SEO. If Leo finds an app idea, Wade might comment on technical feasibility.
- Don't force every agent to respond — only those with something relevant to add.
- Let conversations flow naturally between team members.
- If an agent disagrees with another agent, they should say so respectfully.
- When one agent is doing a tool call (like code_edit or r2_read_file), the OTHER agents should still comment on what's happening. For example, if Zack is editing a file, Kevin might say "looks good" or "wait, I'd change the approach" and Beepbop might react. Don't go silent just because one person is using a tool.
- Each agent should always introduce their perspective with their [agent_id] marker, even if they're just commenting on another agent's work.

## History Context
This is an ongoing conversation. Respond naturally to the user's latest message.

## "Continue" Command
If the user says "continue", "keep going", "go on", or similar, they want you to keep working on whatever you were doing before. Look at the conversation history — what were you working on? What was the last thing you said or did? Pick up from there and keep going. Don't ask "continue with what?" — figure it out from context and DO IT.

${isCodingTeam || isAllTeam ? `## Code Repositories — YOUR WORKSPACE
You have access to R2 cloud storage tools to read AND edit code. These are REAL tools that make REAL changes. Use them.

### Available Tools
- github_list_repos: List all repos the user has opened
- github_list_files: List files in a repo (owner, repo, path)
- github_read_file: Read a file's content (owner, repo, path)
- github_review: Review code in a repo for bugs and issues
- github_edit_file: Edit/create a file — creates a REAL Git commit and pushes it (owner, repo, path, content, message)
- github_delete_file: Delete a file (owner, repo, path, message)
- github_get_commits: See recent commits (owner, repo)
- netlify_deploy: Deploy a repo to a live Netlify site
- netlify_list_deploys: Check deploy status

### How You Work — BE LIKE DEVIN
You are autonomous coders. You DO things. You don't suggest things. You don't give "refactoring ideas." You READ the code, FIND the problem, FIX it, and DEPLOY it.

When the user gives you a task, here's what you do:
1. **STEP 1**: Call github_list_files AND github_read_file in PARALLEL to read the files you need. Also call github_review if needed. Do ALL reads in ONE step.
2. **STEP 2**: Call github_edit_file to fix the files AND netlify_deploy to deploy. Do BOTH in ONE step.
3. **STEP 3**: Report what you did.

You have 6 steps. Be efficient — do multiple tool calls per step. But ALWAYS produce a text response with [agent_id] markers as your FINAL step. If you only do tool calls and no text, the user won't see anything.

### Critical Rules
- **NEVER** say "I suggest changing..." or "You should..." or "Consider refactoring..." — just DO IT.
- **NEVER** give a list of "improvement ideas" — make the improvements.
- **NEVER** ask "should I make this change?" — just make it. Edits are auto-approved.
- **NEVER** add dependencies to package.json. You CANNOT update pnpm-lock.yaml (you can't run pnpm install). Use ONLY the packages that are already installed. If you need state management, use React's built-in useState/useReducer/Context — NOT zustand or other external libraries.
- **NEVER EVER** write fake tool calls as text. Do NOT write @@action:github_edit_file(...) or /github_edit_file(...) or :github_edit_file(...) or anything that looks like a tool call in your text output. USE THE ACTUAL TOOL. Writing tool names as text does NOTHING.
- **ALWAYS** read files before editing them. You need to see the actual code.
- **ALWAYS** talk to each other while working. "I'm reading the auth file now" — "I found the bug" — "On it, fixing it now."
- **ALWAYS** report what you DID, not what you WOULD do. "I edited 3 files and deployed" not "I recommend editing 3 files."
- Edits are AUTO-APPROVED. Just make them. Old versions are saved for rollback if needed.
- Deploy to Netlify whenever the work is done. Don't wait for permission.

### TOOL USAGE — READ THIS CAREFULLY
You have REAL tools available. They are not text commands. They are function calls that the system executes for you.
- To read a file: call the github_read_file tool with owner, repo, and path parameters
- To edit a file: call the github_edit_file tool with owner, repo, path, content, and message parameters. This creates a REAL Git commit.
- To list repos: call the github_list_repos tool
- To list files: call the github_list_files tool with owner, repo, and path parameters
- To review code: call the github_review tool with owner and repo parameters
- To deploy: call the netlify_deploy tool with repo parameter
- To search the web: call the serper_search tool with query parameter
- To draft an email: call the draft_action tool
- To send an email: call the gmail_send tool
- To create a calendar event: call the calendar_create tool

DO NOT write these as text in your response. The system will call them for you. You just need to produce your [agent_id] text response and the system handles the tool calls.

### Self-Maintenance
When the user says "maintain yourselves", "fix bugs", "improve the code", or anything similar:
1. List the repos and find the ai-team-chat repo
2. Run github_review on it
3. Read the files that have issues
4. Fix them with github_edit_file (this creates a real Git commit and pushes to GitHub)
5. Check deploy status with netlify_deploy (the site auto-builds on push)
6. Report what you fixed

The GitHub owner is "andyjxck" and the repo is "ai-team-chat". Use owner="andyjxck" and repo="ai-team-chat" for all GitHub tool calls.

DO ALL OF THIS IN ONE GO. Don't stop and ask. Don't wait for permission. Read, fix, deploy, report. That's the job.

### Working on Yourself
The ai-team-chat repo IS your own code. You can read it, find bugs, fix them, and deploy. You are self-maintaining. When asked to improve yourselves, treat it like any codebase — explore, diagnose, fix, deploy.` : ""}`;

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
    // Use the fallback chain — it auto-advances when rate limited
    const model = getModel();

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
    const hasTools = isCodingTeam || isAllTeam;
    const result = streamText({
      model,
      system: systemPrompt,
      messages: [
        ...historyMessages.slice(0, -1),
        { role: "user", content: userMessage } as ModelMessage,
      ],
      tools: hasTools ? groupTools : undefined,
      stopWhen: isStepCount(hasTools ? 20 : 1),
      maxOutputTokens: hasTools ? 12000 : undefined,
    });

    // ─── Parse the stream for [agent_id] markers ───
    // Use fullStream to get tool call events as they happen (keeps connection alive)
    let fullText = "";
    let currentAgentId: string | null = null;
    let currentAgentText = "";
    let buffer = "";
    let agentIndex = 0;
    const agentResponses: Record<string, string> = {};
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
    const knownAgentIds = new Set(orderedIds);

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
        // Attribute to the right agent
        let toolAgentId = "zack";
        if (["zack", "kevin", "beepbop"].some(id => Object.keys(agentResponses).includes(id))) {
          toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
        }
        sendEvent({ type: "tool_call", agentId: toolAgentId, tool: toolName, args: toolInput });
        sendEvent({ type: "heartbeat", tool: toolName });
      } else if (part.type === "tool-result") {
        const toolName = (part as { toolName: string }).toolName;
        const output = (part as { output: unknown }).output;
        let toolAgentId = "zack";
        if (["zack", "kevin", "beepbop"].some(id => Object.keys(agentResponses).includes(id))) {
          toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
        }
        const error = (output as { error?: string })?.error;
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
            if (buffer.length > 30) {
              buffer = buffer.slice(-30);
            }
            break;
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

            await finalizeAgent(currentAgentId, currentAgentText, chatId, sendEvent, agentResponses);
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
      await finalizeAgent(currentAgentId, currentAgentText, chatId, sendEvent, agentResponses);
    }

    // If no agents responded at all, try a fallback model
    if (!fullText.match(/\[\w+\]/) || !orderedIds.some((id) => fullText.includes(`[${id}]`))) {
      // Advance the fallback chain and try again
      advanceFallbackModel();

      try {
        const fallbackModel = getModel();
        // Get tool call results from the first attempt
        let toolCallSummary = "";
        try {
          const firstToolCalls = await result.toolCalls;
          if (firstToolCalls && firstToolCalls.length > 0) {
            toolCallSummary = "\n\n[Tool calls already completed:\n" + firstToolCalls.map((tc: { toolName: string; input: unknown }) =>
              `- ${tc.toolName}(${JSON.stringify(tc.input).slice(0, 200)})`
            ).join("\n") + "\n]";
          }
        } catch { /* ignore */ }

        // Retry WITHOUT tools so the model just produces text immediately
        const retryUserMessage = toolCallSummary
          ? `${userMessage}\n\n${toolCallSummary}\n\nNow report what you did. Each agent that responds MUST start with [agent_id] in brackets, then their message. Example: [zack] I fixed the bug in route.ts and deployed.`
          : userMessage;

        retryResult = streamText({
          model: fallbackModel,
          system: systemPrompt + "\n\nCRITICAL: You MUST respond with [agent_id] markers. Start each agent's message with [agent_id] in brackets. Example:\n[zack] I read the files and found 3 bugs.\n[maya] I posted the update to X.\n\nDO NOT skip the [agent_id] markers. DO NOT respond without them.",
          messages: [
            ...historyMessages.slice(0, -1),
            { role: "user", content: retryUserMessage } as ModelMessage,
          ],
          // No tools in retry — just generate text
          stopWhen: isStepCount(1),
          maxOutputTokens: isCodingTeam || isAllTeam ? 6000 : undefined,
        });

        let retryText = "";
        for await (const delta of retryResult.textStream) {
          retryText += delta;
        }

        // Check if fallback produced valid agent markers (tolerate markdown bold)
        const hasValidMarkers = orderedIds.some((id) =>
          retryText.includes(`[${id}]`) || retryText.includes(`**[${id}]**`) || retryText.includes(`[${id}]`)
        );
        console.log("[chat] Retry text length:", retryText.length, "hasValidMarkers:", hasValidMarkers);
        console.log("[chat] Retry text (first 300):", retryText.slice(0, 300));

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
                await finalizeAgent(retryAgentId, retryAgentText, chatId, sendEvent, agentResponses);
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
            await finalizeAgent(retryAgentId, retryAgentText, chatId, sendEvent, agentResponses);
          }
        } else {
          // Even without markers, send the text as a system message so we can debug
          sendEvent({
            type: "error",
            message: `No agent markers found. Retry text: ${retryText.slice(0, 500)}`,
          });
        }
      } catch (retryErr) {
        if (isRateLimitError(retryErr)) {
          advanceFallbackModel();
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
        // Code tools go to Zack (or whichever coder responded)
        if (["github_edit_file", "github_review", "github_read_file", "github_list_files", "github_list_repos", "github_delete_file", "github_get_commits", "netlify_deploy", "netlify_list_deploys", "code_edit", "code_review", "r2_read_file", "r2_list_files", "r2_list_repos", "r2_upload_file", "r2_search_files"].includes(toolName)) {
          toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
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

    // ─── Parse fake @@action:tool_name(args) from text and execute real tools ───
    // The model sometimes writes tool calls as text instead of using real tool calls.
    // Parse those and execute them for real.
    try {
      if (groupTools) {
        // Match @@action:tool(...) OR /tool(...) OR :tool(...) patterns
        const fakeToolPattern = /(?:@@action:|\/|:)(\w+)\(([^)]*)\)/g;
        const fakeMatches = [...fullText.matchAll(fakeToolPattern)];

        // Map fake tool names to real tool names
        const toolAliases: Record<string, string> = {
          r2_edit_file: "github_edit_file",
          r2_read_file: "github_read_file",
          r2_upload_file: "github_edit_file",
          r2_list_files: "github_list_files",
          r2_list_repos: "github_list_repos",
          r2_search_files: "github_review",
          code_review: "github_review",
          code_edit: "github_edit_file",
          github_edit_file: "github_edit_file",
          github_read_file: "github_read_file",
          github_list_files: "github_list_files",
          github_list_repos: "github_list_repos",
          github_review: "github_review",
          github_delete_file: "github_delete_file",
          github_get_commits: "github_get_commits",
          netlify_deploy: "netlify_deploy",
          netlify_list_deploys: "netlify_list_deploys",
          draft_action: "draft_action",
          serper_search: "serper_search",
          web_fetch: "web_fetch",
          social_post_x: "social_post_x",
          gmail_send: "gmail_send",
          calendar_create: "calendar_create",
        };

        for (const match of fakeMatches) {
          const rawToolName = match[1];
          const fakeToolName = toolAliases[rawToolName] ?? rawToolName;
          const fakeArgsRaw = match[2];

          // Parse args: key="value", key="value"
          const fakeArgs: Record<string, unknown> = {};
          const argPattern = /(\w+)=["']([^"']*?)["']/g;
          const argMatches = [...fakeArgsRaw.matchAll(argPattern)];
          for (const am of argMatches) {
            // Map common arg name aliases
            const argName = am[1] === "content" ? "newContent" : am[1];
            fakeArgs[argName] = am[2];
          }

          // Check if we have this tool
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolMap = groupTools as any;
          const tool = toolMap[fakeToolName];
          if (tool && tool.execute) {
            // Attribute to the right agent
            let toolAgentId = inScopeAgentIds[0] ?? "system";
            if (["github_edit_file", "github_review", "github_read_file", "github_list_files", "github_list_repos", "github_delete_file", "github_get_commits", "netlify_deploy", "netlify_list_deploys", "code_edit", "code_review", "r2_read_file", "r2_list_files", "r2_list_repos", "r2_upload_file", "r2_search_files"].includes(fakeToolName)) {
              toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
            } else {
              const agentWithTool = Object.keys(agentResponses).find(id => {
                const config = getAgentConfig(id);
                return config?.tools.includes(fakeToolName);
              });
              if (agentWithTool) toolAgentId = agentWithTool;
            }

            console.log(`[chat] Executing fake tool call: ${fakeToolName} by ${toolAgentId}`, fakeArgs);
            sendEvent({ type: "tool_call", agentId: toolAgentId, tool: fakeToolName, args: fakeArgs });

            try {
              const fakeResult = await tool.execute(fakeArgs);
              const error = (fakeResult as { error?: string })?.error;
              sendEvent({ type: "tool_result", agentId: toolAgentId, tool: fakeToolName, result: fakeResult, error });
              console.log(`[chat] Fake tool result:`, JSON.stringify(fakeResult).slice(0, 200));
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "Tool execution failed";
              sendEvent({ type: "tool_result", agentId: toolAgentId, tool: fakeToolName, result: { error: errMsg }, error: errMsg });
            }
          }
        }
      }
    } catch (parseErr) {
      console.error("[chat] Fake tool parser error (non-fatal):", parseErr);
    }

    // ─── Follow-up tool calls for agents that need to take action ───
    // After the group conversation, if any agent said they'd draft/send/create something,
    // do a follow-up call to that agent with tools enabled.
    const actionKeywords = [
      "i'll draft", "i'll send", "i'll create", "i'll post", "i'll write", "i'll schedule",
      "let me draft", "let me send", "let me create", "let me post", "let me write", "let me schedule",
      "drafting", "sending", "creating", "posting", "scheduling",
      "i'll prepare", "let me prepare", "preparing",
      "i'll put together", "let me put together",
      "i'll generate", "let me generate", "generating",
      "i'll set up", "let me set up", "setting up",
      "i'll compose", "let me compose", "composing",
      "i'll build", "let me build", "building",
      "i'll make", "let me make", "making",
      "i'll draft that", "i'll send that", "i'll create that",
      "i'll get that", "let me get that",
      "i'll handle", "let me handle",
      "i'll fix", "let me fix", "fixing",
      "i'll read", "let me read", "reading",
      "i'll edit", "let me edit", "editing",
      "i'll deploy", "let me deploy", "deploying",
      "i'll review", "let me review", "reviewing",
      "i'll check", "let me check", "checking",
      "i'll update", "let me update", "updating",
      "i'll refactor", "let me refactor", "refactoring",
      "i'll patch", "let me patch", "patching",
      "i'll push", "let me push", "pushing",
      "i'll upload", "let me upload", "uploading",
      "i'll search", "let me search", "searching",
      "i'll find", "let me find", "finding",
      "i'll scan", "let me scan", "scanning",
      "i'll look at", "let me look at",
      "i'll pull", "let me pull", "pulling",
      "i'll write that", "i'll draft that up",
      "i'll take care", "let me take care",
      "i'll do that", "let me do that",
      "on it", "got it", "consider it done", "i'm on it",
      "i'll put together a draft", "i'll prepare a draft",
      "i'll write that", "i'll write up",
    ];
    for (const [agentId, agentText] of Object.entries(agentResponses)) {
      const config = getAgentConfig(agentId);
      if (!config || config.tools.length === 0) continue;

      const lowerText = agentText.toLowerCase();
      const wantsAction = actionKeywords.some((kw) => lowerText.includes(kw));
      if (!wantsAction) continue;

      // Do a follow-up call to this agent with tools
      await followUpToolCall(agentId, chatId, content, agentText, sendEvent);
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      advanceFallbackModel();
      sendEvent({ type: "error", message: `Rate limited on current model. Switched to fallback. Try sending again.` });
    } else {
      sendEvent({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }
}

async function finalizeAgent(
  agentId: string,
  text: string,
  chatId: string,
  sendEvent: (e: Record<string, unknown>) => void,
  agentResponses?: Record<string, string>,
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
    tool_calls: [],
  });

  sendEvent({ type: "message_end", agentId, messageId: agentMessageId, content: trimmed });
}

// ─── Follow-up tool call for an agent that wants to take action ───
async function followUpToolCall(
  agentId: string,
  chatId: string,
  userMessage: string,
  agentResponse: string,
  sendEvent: (e: Record<string, unknown>) => void,
) {
  const config = getAgentConfig(agentId);
  if (!config) return;

  (globalThis as Record<string, unknown>).__currentAgentId = agentId;

  const tools = getToolsForAgent(config.tools);

  // Determine which tool to call directly based on what the agent said
  const lowerResponse = agentResponse.toLowerCase();
  const lowerUser = userMessage.toLowerCase();

  // Map intentions to direct tool calls
  let toolToCall: string | null = null;
  let toolArgs: Record<string, unknown> = {};

  if (lowerUser.includes("deploy") || lowerResponse.includes("deploy")) {
    toolToCall = "netlify_deploy";
    toolArgs = { repo: "ai-team-chat", message: agentResponse.slice(0, 100) };
  } else if (lowerUser.includes("review") || lowerUser.includes("bug") || lowerResponse.includes("review") || lowerResponse.includes("bug")) {
    toolToCall = "github_review";
    toolArgs = { owner: "andyjxck", repo: "ai-team-chat", focus: "all" };
  } else if (lowerUser.includes("read") || lowerResponse.includes("reading") || lowerResponse.includes("read the")) {
    toolToCall = "github_list_files";
    toolArgs = { owner: "andyjxck", repo: "ai-team-chat" };
  } else if (lowerResponse.includes("draft") || lowerResponse.includes("email")) {
    toolToCall = "draft_action";
    toolArgs = { type: "email", context: userMessage, agentResponse };
  } else if (lowerResponse.includes("post") && lowerResponse.includes("x")) {
    toolToCall = "social_post_x";
    toolArgs = { content: agentResponse };
  } else if (lowerResponse.includes("search") || lowerUser.includes("lead")) {
    toolToCall = "serper_search";
    toolArgs = { query: userMessage };
  }

  if (!toolToCall) {
    console.log(`[followUpToolCall] No tool matched for ${agentId}`);
    delete (globalThis as Record<string, unknown>).__currentAgentId;
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = (tools as any)[toolToCall];
  if (!tool || !tool.execute) {
    console.log(`[followUpToolCall] Tool ${toolToCall} not available for ${agentId}`);
    delete (globalThis as Record<string, unknown>).__currentAgentId;
    return;
  }

  try {
    console.log(`[followUpToolCall] ${agentId} calling ${toolToCall} directly`);
    sendEvent({ type: "tool_call", agentId, tool: toolToCall, args: toolArgs });

    const result = await tool.execute(toolArgs);
    const error = (result as { error?: string })?.error;
    sendEvent({ type: "tool_result", agentId, tool: toolToCall, result, error });

    // If deploy succeeded, send a confirmation message
    if (toolToCall === "netlify_deploy" && (result as { success?: boolean })?.success) {
      const deployResult = result as { siteUrl?: string; filesDeployed?: number };
      const confirmMsg = `Deployed ${deployResult.filesDeployed ?? 0} files to ${deployResult.siteUrl ?? "Netlify"}.`;
      sendEvent({ type: "agent_start", agentId });
      sendEvent({ type: "token", agentId, text: confirmMsg });
      const msgId = nanoid();
      // Save to DB
      try {
        await supabase.from("messages").insert({
          id: msgId,
          chat_id: chatId,
          sender_id: agentId,
          sender_type: "agent",
          content: confirmMsg,
          mentions: [],
          tool_calls: [],
        });
      } catch { /* ignore */ }
      sendEvent({ type: "message_end", agentId, messageId: msgId, content: confirmMsg });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Tool call failed";
    console.error(`[followUpToolCall] ${agentId} ${toolToCall} failed:`, err);
    sendEvent({ type: "tool_result", agentId, tool: toolToCall, result: { error: errMsg }, error: errMsg });
  } finally {
    delete (globalThis as Record<string, unknown>).__currentAgentId;
  }
}
