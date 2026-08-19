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
          advanceFallbackModel();
          sendEvent({ type: "error", message: `Rate limited on current model. Switched to fallback. Try sending again.` });
        } else if (isModelError(err)) {
          advanceFallbackModel();
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
- When the user asks you to review code: USE github_review tool, then FIX the issues you find.
- When the user asks you to deploy: just call github_edit_file — it pushes to GitHub and Netlify auto-builds. Use netlify_list_deploys to check if it succeeded.
- Never say "I suggest..." or "You should..." — just make the change. The user can reject it if they don't like it.
- Read files before editing. Edit files directly. That's the job.
- BROAD TASKS: If the user says "make the website better" or "improve everything" or "fix all bugs," that means MULTIPLE files. Read all relevant files, then edit ALL of them. One edit is NOT done. Keep going until the task is complete or you run out of steps.
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
      messages: [...historyMessages.slice(0, -1), { role: "user", content } as ModelMessage],
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
      advanceFallbackModel();
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

  // Build the combined system prompt with all agent personas
  const agentRoster = configs.map((c) => `- ${c!.name} (${c!.id}): ${c!.role}`).join("\n");

  const personaSections = configs.map((c) =>
    `### ${c!.name} (id: ${c!.id})\nRole: ${c!.role}\nPersonality: ${c!.persona}`
  ).join("\n\n");

  // Load memories for all participating agents (auto-injected, no tool call needed)
  const memorySections = await Promise.all(
    configs.map((c) => loadAgentMemory(c!.id))
  );
  const memoryBlock = memorySections.filter(Boolean).length > 0
    ? `\n## Agent Memories (auto-loaded)\n${memorySections.filter(Boolean).join("\n")}`
    : "";

  // Fetch opened repos so agents know what they can access
  const isCodingTeam = chatId === "coding-team";
  const isAllTeam = chatId === "all-team";
  let openedReposList = "";
  if (isCodingTeam || isAllTeam) {
    const { data: openedRepos } = await supabase
      .from("github_repos")
      .select("owner, repo_name")
      .order("opened_at", { ascending: false });
    if (openedRepos && openedRepos.length > 0) {
      openedReposList = openedRepos.map((r: any) => `- ${r.owner}/${r.repo_name}`).join("\n");
    }
  }

  const routingRule = isImplicitRouting
    ? `The user did not address anyone specifically. ONE agent should respond — the one whose role is MOST relevant to the message.

CRITICAL RULES:
- Pick the SINGLE best agent to respond. Only ONE agent speaks unless there's a real reason for more.
- Other agents should ONLY join in if:
  1. They DISAGREE with what the first agent said, OR
  2. They have something SUBSTANTIAL to add that the first agent missed
- DO NOT chime in just to agree, praise, or say "good point." That's noise. If you agree, say nothing.
- DO NOT introduce yourself or explain your job unless asked.
- For casual greetings ("hey", "what's up"), ONE agent responds casually. Not everyone.
- If the message is about social media → Maya responds. About leads/business → Leo. About websites/SEO → Sally. About scheduling/email/admin → Evie. About legal → Lex. About code → Zack. Only one, unless someone has a real disagreement.
- If an agent has nothing to add, simply don't include them. Silence is better than noise.`
    : `The user specifically addressed certain agents. Those agents respond. Others should ONLY chime in if they disagree or have something substantial to add. Do NOT respond just to agree.`;

  const replyContext = replyToAgentId
    ? `\n\nIMPORTANT: The user is replying to ${getAgentConfig(replyToAgentId)?.name ?? "someone"}. That agent should respond FIRST.`
    : "";

  const systemPrompt = `You are a team of AI assistants in a group chat. You will respond as multiple agents in a single response.

## Team Members
${agentRoster}

## Agent Personas
${personaSections}
${memoryBlock}

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
[sally] I can add SEO keywords to that post too

Rules:
- Start each agent's message with [agent_id] in brackets, then their text
- One agent per block. Keep messages short like Slack.
- Only include agents that have something to say
- Agents can talk to each other
- Be casual, not corporate
- If using tools, STILL produce a text response with [agent_id] markers after${replyContext}

## Routing — WHO RESPONDS
${routingRule}

### CRITICAL: STAY IN YOUR LANE
- **Coding tasks** (code, bugs, refactoring, deployment, architecture, file editing): ONLY Zack, Kevin, or Beepbop respond. Non-coders (Maya, Leo, Sally, Evie, Lex) MUST NOT respond to coding tasks AT ALL. Not even to "note" it. Not even to "suggest" something. Not even to say "I'll handle the SEO side." If the task is about CODE, non-coders STAY SILENT. They have NO coding tools and CANNOT edit code. Their input on coding tasks is NOISE.
- **Non-coding tasks** (social media, leads, SEO, legal, scheduling): The relevant specialist responds. Coders stay silent unless there's a technical concern.
- **General chat**: One agent responds. Keep it brief.
- If you're NOT the right agent for this task, DO NOT RESPOND. Silence is better than noise.
- DO NOT say "I've noted this" or "I'll track this" or "I'll provide a briefing later" or "I've audited this" — that's useless. Either DO something or stay silent.
- DO NOT pretend you're doing work you can't do. Sally cannot "clean up re-renders in chat-view.tsx" — she has no github_edit_file tool. Lex cannot "implement a centralized apiClient wrapper" — he has no coding tools. If you don't have the tool, you CAN'T do the work. Don't pretend you can.

## Team Dynamics
- ONE agent responds per message. Others ONLY join if they disagree or have something substantial to add.
- DO NOT respond just to agree, praise, or repeat what someone else said. If you agree, stay silent.
- When a coder is doing tool calls (github_edit_file, github_read_file, etc.), NON-CODERS MUST NOT COMMENT. Don't say "looks good" or "nice work" or "I've noted these improvements." That's noise. Let the coders work.
- Each agent should always introduce their perspective with their [agent_id] marker.

## History Context
This is an ongoing conversation. Respond naturally to the user's latest message.

## "Continue" Command
If the user says "continue", "keep going", "go on", or similar, they want you to keep working on whatever you were doing before. Look at the conversation history — what were you working on? What was the last thing you said or did? Pick up from there and keep going. Don't ask "continue with what?" — figure it out from context and DO IT.

${isCodingTeam || isAllTeam ? `## Code Repositories — YOUR WORKSPACE
You have access to GitHub tools to read AND edit code. These are REAL tools that make REAL changes. Use them.

### Opened Repositories
${openedReposList ? `The user has opened these repos for you to access:
${openedReposList}

Use the owner and repo name from this list for all GitHub tool calls. ONLY access repos from this list. If the user asks about a repo that isn't listed, tell them to open it first on the Repos page.` : `The user has not opened any repositories yet. If they ask you to read or edit code, tell them to go to the Repos page and open the repository first.`}

### Available Tools
- github_list_repos: List all repos the user has opened
- github_list_files: List files in a repo (owner, repo, path)
- github_read_file: Read a file's content (owner, repo, path)
- github_review: Review code in a repo for bugs and issues
- github_edit_file: Edit/create a file — creates a REAL Git commit and pushes it (owner, repo, path, content, message)
- github_delete_file: Delete a file (owner, repo, path, message)
- github_get_commits: See recent commits (owner, repo)
- github_create_branch: Create a new branch (owner, repo, branch, fromBranch)
- github_create_pr: Create a pull request (owner, repo, title, head, base, body)
- github_create_issue: Create an issue (owner, repo, title, body, labels)
- github_search_code: Search for code in a repo (owner, repo, query)
- github_list_branches: List all branches (owner, repo)
- netlify_list_deploys: Check recent deploy status (deploys happen automatically on git push)

### How You Work — ACTION NOT WORDS
You are autonomous coders. You DO things. You don't suggest things. You don't give "refactoring ideas." You READ the code, FIND the problem, FIX it, and DEPLOY it.

When the user gives you a task, here's what you do:
1. **STEP 1**: Call github_list_files AND github_read_file in PARALLEL to read the files you need. Do ALL reads in ONE step. Do NOT produce text yet — just read.
2. **STEP 2**: Call github_edit_file to fix the files. The content parameter must be the FULL new file content, not just the changed lines. You read the file in step 1, now output the entire modified file as the content parameter. Make ALL edits. Do NOT produce text yet — just edit.
3. **STEP 3**: NOW produce your text response with [agent_id] markers. Report what you DID. "I edited X, Y, Z. Here's what I changed and why."

DO NOT say "I'm going to refactor X" and then stop. DO NOT say "I'll be deploying in the next few minutes." DO the refactor. DEPLOY. THEN report.

### BROAD TASKS — DO EVERYTHING, NOT ONE THING
When the user gives a BROAD task like "make the website feel better" or "improve the codebase" or "fix all the bugs":
- This is NOT a one-file task. A broad task means MULTIPLE files need changes.
- Read ALL relevant files first (not just one).
- Then edit EVERY file that needs editing. Not one. Not two. ALL of them.
- If the task is "make the website feel better," that means: improve the UI components, fix the styling, improve the chat experience, fix any bugs you find, improve the layout. ALL of it. Not just one CSS tweak.
- You have 50 steps. USE THEM. If you've only used 3 steps and only edited 1 file, YOU ARE NOT DONE. Keep going.
- After each edit, ask yourself: "Is there more to do for this task?" If yes, KEEP EDITING. Don't stop and report after one change.
- Only report when you've genuinely exhausted the task OR run out of steps.
- A broad task should result in MULTIPLE github_edit_file calls across MULTIPLE files. If you only called github_edit_file once, you're not done.

### Critical Rules
- **ACTION OVER WORDS.** Do NOT announce what you're going to do. DO IT, then report what you did. "I edited 3 files and deployed" not "I'm going to edit 3 files and deploy in the next few minutes."
- **NEVER write tool names as text.** Writing "github_edit_file: Refactoring sendMessage..." in your text output does NOTHING. You must CALL the tool, not write its name. If you write a tool name as text instead of calling it, NOTHING HAPPENS. The user sees your text and nothing changes.
- **NEVER say "I am currently finalizing the content for the edit."** Just call github_edit_file with the full content. There is no "finalizing" — you either call the tool or you don't.
- **NEVER say "I am now executing the update properly."** Just call the tool. Announcing that you're going to call a tool is not the same as calling it.
- **NEVER say "Edits are pushed" or "I've refactored X" if you didn't actually call github_edit_file.** If you didn't call the tool, the edit didn't happen. Don't lie about it.
- **github_edit_file requires the FULL file content.** Not a diff. Not just the changed lines. The ENTIRE file content, from line 1 to the end. You read the file in step 1, now reproduce it with your changes as the content parameter.
- **FINISH THE JOB.** You have up to 50 steps. Do NOT stop halfway through a task. If you start refactoring, finish the refactor. If you create a file, fill it with the actual logic. NEVER leave a file with "// Logic will be moved here" or an empty function. NEVER create a skeleton and stop. COMPLETE the work.
- **DO NOT STOP AFTER ONE EDIT.** If the task is broad, edit ALL relevant files. One edit is not "done." Two edits is not "done." Keep going until the task is actually complete or you run out of steps.
- **TRACK YOUR STEPS.** You have a limited number of steps. Be aware of how many you've used. If you're running low, prioritize finishing what you started over starting something new. If you cannot finish, say exactly: "I ran out of steps. Here's what I've done: [list]. Here's what still needs doing: [list]."
- **NEVER** say "I suggest changing..." or "You should..." or "Consider refactoring..." — just DO IT.
- **NEVER** give a list of "improvement ideas" — make the improvements.
- **NEVER** ask "should I make this change?" — just make it. Edits are auto-approved.
- **NEVER** say "I'm currently refactoring..." or "I'll be deploying in the next few minutes" — you are not currently doing anything. You either DO it in this response or you don't. There is no "currently" or "next few minutes."
- **NEVER** add dependencies to package.json. You CANNOT update pnpm-lock.yaml (you can't run pnpm install). Use ONLY the packages that are already installed. If you need state management, use React's built-in useState/useReducer/Context — NOT zustand or other external libraries.
- **To push code changes: call github_edit_file.** That's it. It creates a commit, pushes to GitHub, and Netlify auto-builds. You do NOT need any deploy tool.
- Use netlify_list_deploys ONLY to check if the auto-build succeeded after you've made edits.
- **NEVER EVER** write fake tool calls as text. Do NOT write @@action:github_edit_file(...) or /github_edit_file(...) or :github_edit_file(...) or anything that looks like a tool call in your text output. USE THE ACTUAL TOOL. Writing tool names as text does NOTHING.
- **ALWAYS** read files before editing them. You need to see the actual code.
- **ALWAYS** report what you DID, not what you WOULD do. "I edited 3 files and deployed" not "I recommend editing 3 files."
- **ALWAYS** produce a text response with [agent_id] markers as your FINAL step. If you only do tool calls and no text, the user won't see anything.
- Edits are AUTO-APPROVED. Just make them. Old versions are saved for rollback if needed.
- Only deploy when the user explicitly asks you to deploy, OR when you have completed a coding task and the changes are ready to go live.
- ONLY access repos from the opened list. If a repo isn't opened, tell the user to open it first.

### TOOL USAGE — READ THIS CAREFULLY
You have REAL tools available. They are not text commands. They are function calls that the system executes for you.
- To read a file: call the github_read_file tool with owner, repo, and path parameters
- To edit a file: call the github_edit_file tool with owner, repo, path, content, and message parameters. This creates a REAL Git commit.
- To list repos: call the github_list_repos tool
- To list files: call the github_list_files tool with owner, repo, and path parameters
- To review code: call the github_review tool with owner and repo parameters
- To deploy: just call github_edit_file — it pushes to GitHub and Netlify auto-builds. Use netlify_list_deploys to check if the build succeeded.
- To create a branch: call github_create_branch with owner, repo, branch, and fromBranch
- To create a PR: call github_create_pr with owner, repo, title, head, base, and body
- To create an issue: call github_create_issue with owner, repo, title, body, and labels
- To search code: call github_search_code with owner, repo, and query
- To list branches: call github_list_branches with owner and repo
- To search the web: call the serper_search tool with query parameter
- To draft an email: call the draft_action tool
- To send an email: call the gmail_send tool
- To create a calendar event: call the calendar_create tool

DO NOT write these as text in your response. The system will call them for you. You just need to produce your [agent_id] text response and the system handles the tool calls.

### Self-Maintenance
When the user says "maintain yourselves", "fix bugs", "improve the code", or anything similar:
1. Call github_list_repos to see what's available
2. Run github_review on the repo
3. Read the files that have issues
4. Fix them with github_edit_file (this creates a real Git commit and pushes to GitHub)
5. Check deploy status with netlify_list_deploys (the site auto-builds on push)
6. Report what you fixed

DO ALL OF THIS IN ONE GO. Don't stop and ask. Don't wait for permission. Read, fix, deploy, report. That's the job.` : ""}`;

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
    // Set agent context for tools (use first coder if available, else first in-scope)
    const primaryAgentId = orderedIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? orderedIds[0];
    (globalThis as Record<string, unknown>).__currentAgentId = primaryAgentId;
    const result = streamText({
      model,
      system: systemPrompt,
      messages: [
        ...historyMessages.slice(0, -1),
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
    const knownAgentIds = new Set(orderedIds);

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
        let toolAgentId = currentAgentId ?? orderedIds[0] ?? "system";
        // If no agent is currently speaking, try to infer from tool type
        if (!currentAgentId) {
          const codeTools = ["github_edit_file", "github_read_file", "github_list_files", "github_list_repos", "github_delete_file", "github_get_commits", "github_review", "github_create_branch", "github_create_pr", "github_create_issue", "github_search_code", "github_list_branches", "netlify_list_deploys"];
          if (codeTools.includes(toolName)) {
            toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? orderedIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
          } else {
            // Find an agent that has this tool
            const agentWithTool = orderedIds.find(id => {
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
        let toolAgentId = currentAgentId ?? orderedIds[0] ?? "system";
        if (!currentAgentId) {
          const codeTools = ["github_edit_file", "github_read_file", "github_list_files", "github_list_repos", "github_delete_file", "github_get_commits", "github_review", "github_create_branch", "github_create_pr", "github_create_issue", "github_search_code", "github_list_branches", "netlify_list_deploys"];
          if (codeTools.includes(toolName)) {
            toolAgentId = Object.keys(agentResponses).find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? orderedIds.find(id => ["zack", "kevin", "beepbop"].includes(id)) ?? "zack";
          } else {
            const agentWithTool = orderedIds.find(id => {
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
                  currentAgentId = orderedIds[0];
                }
              } else {
                currentAgentId = orderedIds[0];
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
    if (!fullText.match(/\[\w+\]/) || !orderedIds.some((id) => fullText.includes(`[${id}]`))) {
      // Check if tool calls actually happened — if so, the model worked but just didn't format text
      let toolCallsHappened = false;
      try {
        const firstToolCalls = await result.toolCalls;
        toolCallsHappened = !!(firstToolCalls && firstToolCalls.length > 0);
      } catch { /* ignore */ }

      // If tool calls happened, DON'T advance the fallback model — the model worked, it just didn't produce text markers
      if (!toolCallsHappened) {
        advanceFallbackModel();
      }

      try {
        const fallbackModel = getModel();
        // Get tool call results from the first attempt
        let toolCallSummary = "";
        try {
          const firstToolCalls = await result.toolCalls;
          if (firstToolCalls && firstToolCalls.length > 0) {
            toolCallSummary = "\n\n[Tool calls already completed:\n" + firstToolCalls.map((tc: { toolName: string; input: unknown }) =>
              `- ${tc.toolName}(${JSON.stringify(tc.input).slice(0, 300)})`
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
          maxOutputTokens: isCodingTeam || isAllTeam ? 8000 : undefined,
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
        } else {
          // No markers found — just send the text as the first expected agent
          const fallbackAgentId = orderedIds[0];
          if (fallbackAgentId && retryText.trim()) {
            sendEvent({ type: "agent_start", agentId: fallbackAgentId });
            sendEvent({ type: "token", agentId: fallbackAgentId, text: retryText });
            await finalizeAgent(fallbackAgentId, retryText, chatId, sendEvent, agentResponses, agentToolCallMap[fallbackAgentId]);
          } else {
            sendEvent({
              type: "error",
              message: `No response generated. Retry text: ${retryText.slice(0, 500)}`,
            });
          }
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
      advanceFallbackModel();
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
