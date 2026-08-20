import { schedule } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const SITE_URL = process.env.URL || "https://ai-team-chat.netlify.app";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CODING_TEAM_CHAT_ID = "coding-team";

// How long to wait after last human message before autonomous work starts
const IDLE_THRESHOLD_SEC = 10; // 10 seconds of no human activity = idle

// How long to wait between autonomous work sessions
const WORK_COOLDOWN_SEC = 30; // 30 seconds between autonomous sessions

// Check if the chat is idle (no recent human messages)
async function isChatIdle(): Promise<{ idle: boolean; lastHumanMsg: Date | null; lastAgentMsg: Date | null }> {
  const { data: recent } = await supabase
    .from("messages")
    .select("sender_type, created_at")
    .eq("chat_id", CODING_TEAM_CHAT_ID)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!recent || recent.length === 0) {
    return { idle: true, lastHumanMsg: null, lastAgentMsg: null };
  }

  const lastHuman = recent.find(m => m.sender_type === "human");
  const lastAgent = recent.find(m => m.sender_type === "agent");

  const lastHumanTime = lastHuman ? new Date(lastHuman.created_at) : null;
  const lastAgentTime = lastAgent ? new Date(lastAgent.created_at) : null;
  const now = new Date();

  // Idle if no human message in last IDLE_THRESHOLD_SEC seconds
  const humanIdle = !lastHumanTime || (now.getTime() - lastHumanTime.getTime()) > IDLE_THRESHOLD_SEC * 1000;

  return { idle: humanIdle, lastHumanMsg: lastHumanTime, lastAgentMsg: lastAgentTime };
}

// Check if we recently did autonomous work (cooldown)
async function recentlyWorked(): Promise<boolean> {
  const { data: recent } = await supabase
    .from("messages")
    .select("sender_id, content, created_at")
    .eq("chat_id", CODING_TEAM_CHAT_ID)
    .eq("sender_type", "agent")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!recent || recent.length === 0) return false;

  const lastAgentMsg = new Date(recent[0].created_at);
  const now = new Date();
  const secondsSince = (now.getTime() - lastAgentMsg.getTime()) / 1000;

  // Always wait at least WORK_COOLDOWN_SEC after any agent message
  return secondsSince < WORK_COOLDOWN_SEC;
}

// Get opened repos
async function getOpenedRepos(): Promise<{ owner: string; repo_name: string }[]> {
  const { data } = await supabase.from("github_repos").select("owner, repo_name").limit(10);
  return (data ?? []) as { owner: string; repo_name: string }[];
}

// List files in a repo
async function listRepoFiles(owner: string, repo: string, path = ""): Promise<{ name: string; path: string; type: string }[]> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((f: { name: string; path: string; type: string }) => ({ name: f.name, path: f.path, type: f.type }));
}

// Read a file
async function readFile(owner: string, repo: string, path: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.content) return null;
  return Buffer.from(data.content, "base64").toString("utf-8");
}

// Get file SHA
async function getFileSha(owner: string, repo: string, path: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha ?? null;
}

// Edit a file (creates a commit)
async function editFile(owner: string, repo: string, path: string, content: string, message: string, sha?: string): Promise<boolean> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: Buffer.from(content).toString("base64"), sha, branch: "main" }),
  });
  return res.ok;
}

// Get recent commits to understand what's been changed
async function getRecentCommits(owner: string, repo: string): Promise<{ message: string; date: string }[]> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=5`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.map((c: { commit: { message: string; committer: { date: string } } }) => ({
    message: c.commit.message,
    date: c.commit.committer.date,
  }));
}

// Call Gemini to decide what to work on
async function decideWorkTopic(
  repos: { owner: string; repo_name: string }[],
  recentCommits: { message: string; date: string }[],
  recentMessages: { sender_id: string; content: string }[],
): Promise<{ topic: string; files: string[]; description: string } | null> {
  const repoList = repos.map(r => `${r.owner}/${r.repo_name}`).join(", ");
  const commitList = recentCommits.map(c => `- ${c.message}`).join("\n");
  const msgList = recentMessages.slice(-5).map(m => `${m.sender_id}: ${m.content.slice(0, 100)}`).join("\n");

  const prompt = `You are Zack, a senior engineer. You're about to start an autonomous work session to improve the codebase.

Available repos: ${repoList}
Recent commits:
${commitList}

Recent team chat:
${msgList}

Pick ONE small, safe, high-value improvement to make right now. Focus on:
- Bug fixes (actual bugs you can spot from file names/structure)
- UI/UX improvements (styling, layout, responsiveness)
- Performance (removing unnecessary re-renders, optimizing queries)
- Code quality (dead code, duplicated logic, missing error handling)

DO NOT pick:
- Large refactors
- New dependencies
- Architecture changes
- "Add tests"

Respond in JSON:
{"topic": "short description", "files": ["path/to/file1"], "description": "what to change and why"}

Pick something you can actually do by reading and editing 1-2 files.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1000, responseMimeType: "application/json" },
      }),
    },
  );

  if (!res.ok) {
    console.error("[autonomous] Gemini API error:", res.status);
    return null;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    console.error("[autonomous] Failed to parse work topic JSON");
    return null;
  }
}

// Call Gemini to generate improved file content
async function getImprovedContent(filePath: string, currentContent: string, description: string): Promise<string | null> {
  const prompt = `You are Zack, a senior engineer. Improve this file.

File: ${filePath}
Task: ${description}

Current content:
\`\`\`
${currentContent.slice(0, 15000)}
\`\`\`

Output the COMPLETE updated file. No markdown fences. No explanations. Just the raw file content.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 30000 },
      }),
    },
  );

  if (!res.ok) return null;
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  return text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
}

// Send a message to the coding team chat
async function sendChatMessage(agentId: string, content: string) {
  const messageId = `${agentId}-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await supabase.from("messages").insert({
    id: messageId,
    chat_id: CODING_TEAM_CHAT_ID,
    sender_id: agentId,
    sender_type: "agent",
    content,
    mentions: [],
    tool_calls: [],
  });
  console.log(`[autonomous] ${agentId} sent: ${content.slice(0, 80)}...`);
}

export const handler = schedule("*/1 * * * *", async () => {
  console.log("[autonomous] Heartbeat check at", new Date().toISOString());

  try {
  if (!GEMINI_API_KEY || !GITHUB_TOKEN) {
    console.log("[autonomous] Missing API keys — skipping");
    return { statusCode: 200, body: JSON.stringify({ status: "No keys" }) };
  }

  // Check if chat is idle
  const { idle, lastHumanMsg } = await isChatIdle();
  if (!idle) {
    console.log("[autonomous] Chat is active (recent human message) — skipping");
    return { statusCode: 200, body: JSON.stringify({ status: "Chat active" }) };
  }

  // Check cooldown
  const recentlyWorkedResult = await recentlyWorked();
  if (recentlyWorkedResult) {
    console.log("[autonomous] Recently worked — skipping (cooldown)");
    return { statusCode: 200, body: JSON.stringify({ status: "Cooldown" }) };
  }

  // Get opened repos
  const repos = await getOpenedRepos();
  if (repos.length === 0) {
    console.log("[autonomous] No repos opened — skipping");
    return { statusCode: 200, body: JSON.stringify({ status: "No repos" }) };
  }

  // Pick first repo
  const repo = repos[0];
  const repoInfo = `${repo.owner}/${repo.repo_name}`;

  // Get recent commits and messages for context
  const [recentCommits, recentMsgData] = await Promise.all([
    getRecentCommits(repo.owner, repo.repo_name),
    supabase.from("messages")
      .select("sender_id, content")
      .eq("chat_id", CODING_TEAM_CHAT_ID)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const recentMessages = (recentMsgData.data ?? []).reverse();

  // Decide what to work on
  const workTopic = await decideWorkTopic(repos, recentCommits, recentMessages);
  if (!workTopic || !workTopic.files || workTopic.files.length === 0) {
    console.log("[autonomous] No work topic identified — skipping");
    return { statusCode: 200, body: JSON.stringify({ status: "No topic" }) };
  }

  console.log(`[autonomous] Work topic: ${workTopic.topic} — files: ${workTopic.files.join(", ")}`);

  // Zack announces what he's going to do
  await sendChatMessage("zack", `🔧 **Autonomous work session**\n\nI'm going to ${workTopic.topic}. ${workTopic.description}\n\nLet me read the file and make the change.`);

  // Read and edit each file
  let editsMade = 0;
  const editLog: string[] = [];

  for (const filePath of workTopic.files.slice(0, 2)) {
    console.log(`[autonomous] Reading ${filePath}...`);
    const currentContent = await readFile(repo.owner, repo.repo_name, filePath);
    if (!currentContent) {
      console.log(`[autonomous] Could not read ${filePath} — skipping`);
      continue;
    }

    // Generate improved content
    const improvedContent = await getImprovedContent(filePath, currentContent, workTopic.description);
    if (!improvedContent || improvedContent.length < 10) {
      console.log(`[autonomous] Could not generate improved content for ${filePath} — skipping`);
      continue;
    }

    // Don't commit if nothing changed
    if (improvedContent.trim() === currentContent.trim()) {
      console.log(`[autonomous] No changes for ${filePath} — skipping`);
      continue;
    }

    // Get SHA and edit
    const sha = await getFileSha(repo.owner, repo.repo_name, filePath);
    const success = await editFile(repo.owner, repo.repo_name, filePath, improvedContent, `Auto: ${workTopic.topic}`, sha ?? undefined);

    if (success) {
      editsMade++;
      editLog.push(`✅ ${filePath}`);
      console.log(`[autonomous] ✅ Edited ${filePath}`);
    } else {
      editLog.push(`❌ ${filePath} (failed)`);
      console.log(`[autonomous] ❌ Failed to edit ${filePath}`);
    }
  }

  // Report results
  if (editsMade > 0) {
    const report = `🔧 **Autonomous work complete**\n\n${workTopic.topic}\n\nChanges:\n${editLog.join("\n")}\n\nPushed to GitHub — Netlify is auto-deploying.`;
    await sendChatMessage("zack", report);
  } else {
    const report = `🔧 Checked the codebase but didn't find anything worth changing right now. Everything looks solid. I'll check again in a few minutes.`;
    await sendChatMessage("zack", report);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ edits: editsMade, topic: workTopic.topic }),
  };
  } catch (err) {
    console.error("[autonomous] FATAL ERROR:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }) };
  }
});
