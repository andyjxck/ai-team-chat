import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const AGENTS = [
  { id: "evie", name: "Evie", role: "Executive Assistant", prompt: `You are Evie, the Executive Assistant. You're checking in proactively. If there's something the user should know — an upcoming appointment, a deadline, a reminder — send a SHORT proactive message. If there's nothing to report, respond with exactly "SKIP". Keep it casual and brief.` },
  { id: "lex", name: "Lex", role: "Legal Assistant", prompt: `You are Lex. If you notice any legal docs that are outdated, send a SHORT proactive message. If everything looks fine, respond with exactly "SKIP".` },
  { id: "maya", name: "Maya", role: "Social Media Manager", prompt: `You are Maya. Search for trending topics. If there's something trending that fits the user's brand, send a SHORT proactive message. If nothing interesting, respond with exactly "SKIP".` },
  { id: "sally", name: "Sally", role: "Website & SEO Builder", prompt: `You are Sally. Search for recent Google algorithm updates, SEO news, or website opportunities. If there's something important, send a SHORT proactive message. If nothing notable, respond with exactly "SKIP".` },
  { id: "leo", name: "Leo", role: "Lead Generator", prompt: `You are Leo. Search for new app ideas or opportunities today. If you find something promising, send a SHORT proactive message. If nothing interesting, respond with exactly "SKIP".` },
];

async function hasUserReplied(chatId: string, agentId: string): Promise<boolean> {
  const { data: recent } = await supabase
    .from("messages")
    .select("sender_id, sender_type, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!recent || recent.length === 0) return true;
  const lastAgentIdx = recent.findIndex((m) => m.sender_id === agentId && m.sender_type === "agent");
  if (lastAgentIdx === -1) return true;
  return recent.slice(0, lastAgentIdx).some((m) => m.sender_type === "human");
}

async function getRecentContext(chatId: string): Promise<string> {
  const { data: messages } = await supabase
    .from("messages")
    .select("sender_id, sender_type, content, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (!messages || messages.length === 0) return "No previous messages.";
  return messages.reverse().map((m) => `${m.sender_type === "human" ? "User" : m.sender_id}: ${m.content.slice(0, 200)}`).join("\n");
}

async function generateProactiveMessage(agent: typeof AGENTS[0], context: string): Promise<string> {
  const fullPrompt = `${agent.prompt}\n\nCurrent time: ${new Date().toISOString()}\n\nRecent conversation:\n${context}\n\nGenerate your proactive message now. Respond with "SKIP" if nothing worth saying.`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
      }),
    },
  );
  if (!res.ok) return "SKIP";
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "SKIP").trim();
}

export async function POST(req: NextRequest) {
  try {
    const { agentId } = await req.json().catch(() => ({}));

    let sentCount = 0;
    let skipCount = 0;
    const results: { agent: string; status: string; message?: string }[] = [];

    const agentsToCheck = agentId ? AGENTS.filter((a) => a.id === agentId) : AGENTS;

    for (const agent of agentsToCheck) {
      try {
        const chatId = `dm-${agent.id}`;
        const canSend = await hasUserReplied(chatId, agent.id);
        if (!canSend) {
          results.push({ agent: agent.id, status: "skipped (user hasn't replied)" });
          skipCount++;
          continue;
        }

        const context = await getRecentContext(chatId);
        const message = await generateProactiveMessage(agent, context);

        if (message === "SKIP" || message.length < 5) {
          results.push({ agent: agent.id, status: "skipped (nothing to say)" });
          skipCount++;
          continue;
        }

        const messageId = `${agent.id}-proactive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await supabase.from("messages").insert({
          id: messageId,
          chat_id: chatId,
          sender_id: agent.id,
          sender_type: "agent",
          content: message,
          mentions: [],
        });

        results.push({ agent: agent.id, status: "sent", message: message.slice(0, 100) });
        sentCount++;
      } catch (err) {
        results.push({ agent: agent.id, status: `error: ${err instanceof Error ? err.message : "unknown"}` });
      }
    }

    return NextResponse.json({ sent: sentCount, skipped: skipCount, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
