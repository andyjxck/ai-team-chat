import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CODING_TEAM_CHAT_ID = "coding-team";
const IDLE_THRESHOLD_SEC = 10;
const WORK_COOLDOWN_SEC = 30;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;

// ─── GitHub helpers ───
async function getOpenedRepos(): Promise<{ owner: string; repo_name: string }[]> {
  const { data } = await supabase.from("github_repos").select("owner, repo_name").limit(10);
  return (data ?? []) as { owner: string; repo_name: string }[];
}

async function listRepoFiles(owner: string, repo: string, path = ""): Promise<{ name: string; path: string; type: string }[]> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((f: { name: string; path: string; type: string }) => ({ name: f.name, path: f.path, type: f.type }));
}

async function readFile(owner: string, repo: string, path: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.content) return null;
  return Buffer.from(data.content, "base64").toString("utf-8");
}

async function getFileSha(owner: string, repo: string, path: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha ?? null;
}

async function editFile(owner: string, repo: string, path: string, content: string, message: string, sha?: string): Promise<boolean> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: Buffer.from(content).toString("base64"), sha, branch: "main" }),
  });
  return res.ok;
}

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

// ─── Gemini helpers ───
async function decideWorkTopic(
  repos: { owner: string; repo_name: string }[],
  recentCommits: { message: string; date: string }[],
  recentMessages: { sender_id: string; content: string }[],
): Promise<{ topic: string; files: string[]; description: string } | null> {
  const repoList = repos.map(r => `${r.owner}/${r.repo_name}`).join(", ");
  const commitList = recentCommits.map(c => `- ${c.message}`).join("\n");
  const msgList = recentMessages.slice(-5).map(m => `${m.sender_id}: ${m.content.slice(0, 100)}`).join("\n");

  const prompt = `You are Zack, a senior engineer. You're about to start an autonomous work session to improve the app.

Available repos: ${repoList}
Recent commits:
${commitList}

Recent team chat:
${msgList}

Pick ONE improvement to make right now. You can change ANYTHING:
- UI/UX: styling, layout, colors, animations, responsiveness, mobile layout
- Features: add new functionality, improve existing features, new pages
- Bug fixes: actual bugs you can spot
- Performance: optimize queries, reduce re-renders
- Code quality: dead code, duplicated logic, error handling
- Their own code: improve the agents, tools, prompts, autonomous work system
- Visual polish: make it look better, feel better, work better

The only rules:
- No new dependencies (use what's already installed)
- No placeholder content — everything must be fully functional
- Read files before editing them

Respond in JSON:
{"topic": "short description", "files": ["path/to/file1", "path/to/file2"], "description": "detailed description of what to change in each file and why"}

You can edit up to 5 files per session. Make real, visible improvements.`;

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
    console.error("[autonomous] Gemini API error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    console.error("[autonomous] Failed to parse work topic JSON:", text);
    return null;
  }
}

async function getImprovedContent(filePath: string, currentContent: string, description: string): Promise<string | null> {
  const prompt = `You are Zack, a senior engineer. Improve this file.

File: ${filePath}
Task: ${description}

Current content:
\`\`\`
${currentContent.slice(0, 30000)}
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
}

// ─── Main handler ───
export async function POST() {
  try {
    if (!GEMINI_API_KEY || !GITHUB_TOKEN) {
      return Response.json({ status: "missing keys" });
    }

    // Check if chat is idle
    const { data: recent } = await supabase
      .from("messages")
      .select("sender_type, created_at")
      .eq("chat_id", CODING_TEAM_CHAT_ID)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!recent || recent.length === 0) {
      return Response.json({ status: "no messages" });
    }

    const lastHuman = recent.find(m => m.sender_type === "human");
    const lastAgent = recent.find(m => m.sender_type === "agent");
    const now = new Date();

    const humanIdle = !lastHuman || (now.getTime() - new Date(lastHuman.created_at).getTime()) > IDLE_THRESHOLD_SEC * 1000;
    if (!humanIdle) {
      return Response.json({ status: "chat active" });
    }

    if (lastAgent) {
      const secondsSince = (now.getTime() - new Date(lastAgent.created_at).getTime()) / 1000;
      if (secondsSince < WORK_COOLDOWN_SEC) {
        return Response.json({ status: "cooldown", secondsLeft: Math.ceil(WORK_COOLDOWN_SEC - secondsSince) });
      }
    }

    // ─── Do the actual work ───
    const repos = await getOpenedRepos();
    if (repos.length === 0) {
      return Response.json({ status: "no repos" });
    }

    const repo = repos[0];

    const [recentCommits, recentMsgData] = await Promise.all([
      getRecentCommits(repo.owner, repo.repo_name),
      supabase.from("messages")
        .select("sender_id, content")
        .eq("chat_id", CODING_TEAM_CHAT_ID)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const recentMessages = (recentMsgData.data ?? []).reverse();

    const workTopic = await decideWorkTopic(repos, recentCommits, recentMessages);
    if (!workTopic || !workTopic.files || workTopic.files.length === 0) {
      return Response.json({ status: "no topic" });
    }

    console.log(`[autonomous] Work topic: ${workTopic.topic} — files: ${workTopic.files.join(", ")}`);

    await sendChatMessage("zack", `🔧 **Autonomous work session**\n\nI'm going to ${workTopic.topic}. ${workTopic.description}\n\nLet me read the file and make the change.`);

    let editsMade = 0;
    const editLog: string[] = [];

    for (const filePath of workTopic.files.slice(0, 5)) {
      const currentContent = await readFile(repo.owner, repo.repo_name, filePath);
      if (!currentContent) {
        editLog.push(`❌ ${filePath} (could not read)`);
        continue;
      }

      const improvedContent = await getImprovedContent(filePath, currentContent, workTopic.description);
      if (!improvedContent || improvedContent.length < 10) {
        editLog.push(`❌ ${filePath} (could not generate)`);
        continue;
      }

      if (improvedContent.trim() === currentContent.trim()) {
        editLog.push(`⏭️ ${filePath} (no changes needed)`);
        continue;
      }

      const sha = await getFileSha(repo.owner, repo.repo_name, filePath);
      const success = await editFile(repo.owner, repo.repo_name, filePath, improvedContent, `Auto: ${workTopic.topic}`, sha ?? undefined);

      if (success) {
        editsMade++;
        editLog.push(`✅ ${filePath}`);
      } else {
        editLog.push(`❌ ${filePath} (edit failed)`);
      }
    }

    if (editsMade > 0) {
      await sendChatMessage("zack", `🔧 **Autonomous work complete**\n\n${workTopic.topic}\n\nChanges:\n${editLog.join("\n")}\n\nPushed to GitHub — Netlify is auto-deploying.`);
    } else {
      await sendChatMessage("zack", `🔧 Checked the codebase but didn't find anything worth changing right now. ${editLog.join("; ")}`);
    }

    return Response.json({ status: "done", edits: editsMade, topic: workTopic.topic });
  } catch (err) {
    console.error("[autonomous] FATAL:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
