import { schedule } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const SITE_URL = process.env.URL || "https://ai-team-chat.netlify.app";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Agent definitions for proactive outreach
const AGENTS = [
  {
    id: "evie",
    name: "Evie",
    role: "Executive Assistant",
    prompt: `You are Evie, the Executive Assistant. You're checking in proactively. Look at the conversation history and the current time. If there's something the user should know — an upcoming appointment, an unread email, a deadline, a reminder — send a SHORT proactive message. If there's nothing to report, respond with exactly "SKIP". Keep it casual and brief.`,
  },
  {
    id: "lex",
    name: "Lex",
    role: "Legal Assistant",
    prompt: `You are Lex, the Legal Assistant. You're checking in proactively. If you notice any legal documents in the repos that are outdated or missing required sections (GDPR, CCPA, etc.), send a SHORT proactive message about it. If everything looks fine, respond with exactly "SKIP".`,
  },
  {
    id: "maya",
    name: "Maya",
    role: "Social Media Manager",
    prompt: `You are Maya, the Social Media Manager. You're checking in proactively. Search for trending topics right now. If there's something trending that fits the user's brand, send a SHORT proactive message suggesting a post. If nothing interesting is trending, respond with exactly "SKIP". Keep it casual.`,
  },
  {
    id: "sally",
    name: "Sally",
    role: "Website & SEO Builder",
    prompt: `You are Sally, the Website & SEO Builder. You're checking in proactively. Search for recent Google algorithm updates, SEO news, or website opportunities. If there's something important the user should know, send a SHORT proactive message. If nothing notable, respond with exactly "SKIP".`,
  },
  {
    id: "leo",
    name: "Leo",
    role: "Lead Generator",
    prompt: `You are Leo, the Lead Generator. You're checking in proactively. Search for new app ideas or opportunities today. If you find something promising, send a SHORT proactive message with a quick rating. If nothing interesting, respond with exactly "SKIP".`,
  },
];

// Check if user has replied since the agent's last message
async function hasUserReplied(chatId: string, agentId: string): Promise<boolean> {
  const { data: recent } = await supabase
    .from("messages")
    .select("sender_id, sender_type, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!recent || recent.length === 0) return true; // No messages yet — allow

  const lastAgentIdx = recent.findIndex(
    (m) => m.sender_id === agentId && m.sender_type === "agent",
  );

  if (lastAgentIdx === -1) return true; // Agent hasn't sent anything — allow

  // Check if there's a human message after the agent's last message
  return recent.slice(0, lastAgentIdx).some((m) => m.sender_type === "human");
}

// Get recent conversation context for an agent
async function getRecentContext(chatId: string): Promise<string> {
  const { data: messages } = await supabase
    .from("messages")
    .select("sender_id, sender_type, content, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!messages || messages.length === 0) return "No previous messages.";

  return messages
    .reverse()
    .map((m) => `${m.sender_type === "human" ? "User" : m.sender_id}: ${m.content.slice(0, 200)}`)
    .join("\n");
}

// Send a proactive message
async function sendProactiveMessage(chatId: string, agentId: string, content: string) {
  const messageId = `${agentId}-proactive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await supabase.from("messages").insert({
    id: messageId,
    chat_id: chatId,
    sender_id: agentId,
    sender_type: "agent",
    content,
    mentions: [],
  });
  console.log(`[proactive] ${agentId} sent message to ${chatId}: ${content.slice(0, 80)}...`);
}

// Call Gemini to generate a proactive message
async function generateProactiveMessage(
  agent: typeof AGENTS[0],
  context: string,
): Promise<string> {
  const fullPrompt = `${agent.prompt}

Current time: ${new Date().toISOString()}

Recent conversation context:
${context}

Generate your proactive message now. Remember: respond with "SKIP" if there's nothing worth saying.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        },
      }),
    },
  );

  if (!res.ok) {
    console.error(`[proactive] Gemini API error for ${agent.id}: ${res.status}`);
    return "SKIP";
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "SKIP";
  return text.trim();
}

export const handler = schedule("0 9,13,17 * * *", async () => {
  console.log("[proactive] Scheduled trigger running at", new Date().toISOString());

  if (!GEMINI_API_KEY) {
    console.error("[proactive] No GEMINI_API_KEY — skipping");
    return { statusCode: 200, body: "No API key" };
  }

  let sentCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const agent of AGENTS) {
    try {
      const chatId = `dm-${agent.id}`;

      // Check if user has replied since agent's last message
      const canSend = await hasUserReplied(chatId, agent.id);
      if (!canSend) {
        console.log(`[proactive] ${agent.id}: user hasn't replied to last message — skipping`);
        skipCount++;
        continue;
      }

      // Get conversation context
      const context = await getRecentContext(chatId);

      // Generate proactive message
      const message = await generateProactiveMessage(agent, context);

      if (message === "SKIP" || message.length < 5) {
        console.log(`[proactive] ${agent.id}: nothing to say — skipping`);
        skipCount++;
        continue;
      }

      // Send the message
      await sendProactiveMessage(chatId, agent.id, message);
      sentCount++;
    } catch (err) {
      console.error(`[proactive] Error for ${agent.id}:`, err);
      errorCount++;
    }
  }

  console.log(`[proactive] Done. Sent: ${sentCount}, Skipped: ${skipCount}, Errors: ${errorCount}`);

  return {
    statusCode: 200,
    body: JSON.stringify({ sent: sentCount, skipped: skipCount, errors: errorCount }),
  };
});
