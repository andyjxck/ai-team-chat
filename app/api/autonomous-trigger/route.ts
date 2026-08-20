import { supabase } from "@/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CODING_TEAM_CHAT_ID = "coding-team";
const IDLE_THRESHOLD_SEC = 10;
const WORK_COOLDOWN_SEC = 30;

export async function POST() {
  try {
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

    // Trigger the function
    const functionUrl = "https://ai-team-chat.netlify.app/.netlify/functions/autonomous-work";
    fetch(functionUrl, { method: "GET" }).catch(() => {});

    return Response.json({ status: "triggered" });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
