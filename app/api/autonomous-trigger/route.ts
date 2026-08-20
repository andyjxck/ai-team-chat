import { supabase } from "@/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CODING_TEAM_CHAT_ID = "coding-team";
const IDLE_THRESHOLD_MIN = 3;
const WORK_COOLDOWN_MIN = 10;

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

    const humanIdle = !lastHuman || (now.getTime() - new Date(lastHuman.created_at).getTime()) > IDLE_THRESHOLD_MIN * 60 * 1000;
    if (!humanIdle) {
      return Response.json({ status: "chat active" });
    }

    if (lastAgent) {
      const minutesSince = (now.getTime() - new Date(lastAgent.created_at).getTime()) / (1000 * 60);
      if (minutesSince < WORK_COOLDOWN_MIN) {
        return Response.json({ status: "cooldown", minutesLeft: Math.ceil(WORK_COOLDOWN_MIN - minutesSince) });
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
