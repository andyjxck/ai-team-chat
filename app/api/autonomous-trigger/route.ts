import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CODING_TEAM_CHAT_ID = "coding-team";
const IDLE_THRESHOLD_SEC = 10;
const WORK_COOLDOWN_SEC = 10;

// Check if autonomous mode is running (set by user typing "start"/"stop" in coding team)
async function isAutonomousRunning(): Promise<boolean> {
  const { data } = await supabase
    .from("memory")
    .select("value")
    .eq("agent_id", "system")
    .eq("key", "autonomous_running")
    .limit(1);
  return data?.[0]?.value === "true";
}

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

  const prompt = `You are Zack, a senior engineer. Your goal is to identify ONE impactful improvement for the \`ai-team-chat\` app.

Context:
Available repos: ${repoList}
Recent commits:
${commitList}
Recent team chat:
${msgList}

Improvement Categories:
- UI/UX: Enhance design, layout, or responsiveness.
- Features: Add new functionality or improve existing ones.
- Agent Logic/Config: Refine agent behavior, tools, or autonomy.
- Tooling: Improve or add new tools.
- Prompts/Routing: Optimize system prompts or routing logic.
- Autonomous Core: Enhance autonomous work functionality.
- Infrastructure: Improve backend, database, or deployment.

Instructions for selecting an improvement:
1.  **Broader Impact & Variety**: Consider all available improvement categories equally. Strive for diversity in the types of tasks selected over time, avoiding a narrow focus on self-referential improvements (e.g., only improving the autonomous core).
2.  **User-Facing Priority**: Prioritize tasks that have a clear and positive impact on the end-user experience, overall application functionality, or stability.
3.  **Novelty**: Look for areas that haven't been addressed recently or represent a different type of improvement compared to past autonomous sessions. Avoid repetitive tasks.
4.  **Real & Impactful**: Focus on real, impactful improvements over minor tweaks.

Strict Constraints:
- Use existing dependencies only.
- Avoid placeholder content.
- Always read files before editing.
- Limit changes to a maximum of 5 files.

Your response MUST be a JSON object:
{"topic": "Concise summary of the improvement", "files": ["path/to/file1", "path/to/file2"], "description": "Detailed explanation of the changes for each file and the rationale."}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8000, responseMimeType: "application/json" },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error("[autonomous] Gemini API error:", res.status, errText);
    return null;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error("[autonomous] No text in Gemini response. Finish reason:", data.candidates?.[0]?.finishReason, "Usage:", data.usageMetadata);
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    console.error("[autonomous] Failed to parse work topic JSON:", text.slice(0, 200));
    return null;
  }
}

async function getImprovedContent(filePath: string, currentContent: string, description: string): Promise<string | null> {
  const prompt = `You are Zack, a senior engineer. Improve this file.\n\nFile: ${filePath}\nTask: ${description}\n\nCurrent content:\n\`\`\`\n${currentContent.slice(0, 30000)}\n\`\`\`\n\nOutput the COMPLETE updated file. No markdown fences. No explanations. Just the raw file content.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 65536 },
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

    // Check if autonomous mode is running
    const running = await isAutonomousRunning();
    if (!running) {
      return Response.json({ status: "not running" });
    }

    // When autonomous mode is explicitly running, skip the idle check.
    // The user said "go" — the agents should keep working regardless of recent messages.
    // Only apply cooldown to prevent rapid-fire duplicate work.
    const { data: recent } = await supabase
      .from("messages")
      .select("sender_type, created_at")
      .eq("chat_id", CODING_TEAM_CHAT_ID)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!recent || recent.length === 0) {
      return Response.json({ status: "no messages" });
    }

    const lastAgent = recent.find(m => m.sender_type === "agent");
    const now = new Date();

    // Only check cooldown — skip idle check when explicitly running
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

    await sendChatMessage("zack", `🔧 **Autonomous work session**\n\nI\'m going to ${workTopic.topic}. ${workTopic.description}\n\nLet me read the file and make the change.`);

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
      await sendChatMessage("zack", `🔧 Checked the codebase but didn\'t find anything worth changing right now. ${editLog.join("; ")}`);
    }

    return Response.json({ status: "done", edits: editsMade, topic: workTopic.topic });
  } catch (err) {
    console.error("[autonomous] FATAL:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}