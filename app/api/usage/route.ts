import { supabase } from "@/db/client";

export async function GET() {
  try {
    // Get last 28 days of usage
    const { data: recent, error } = await supabase
      .from("api_usage")
      .select("*")
      .gte("created_at", new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    // Aggregate stats
    const records = recent ?? [];
    const totalCost = records.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
    const totalRequests = records.length;
    const totalInputTokens = records.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0);
    const totalOutputTokens = records.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0);
    const totalToolCalls = records.reduce((sum, r) => sum + (r.tool_calls ?? 0), 0);

    // By model
    const byModel: Record<string, { requests: number; cost: number; inputTokens: number; outputTokens: number }> = {};
    for (const r of records) {
      const key = r.model;
      if (!byModel[key]) byModel[key] = { requests: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
      byModel[key].requests++;
      byModel[key].cost += Number(r.cost_usd ?? 0);
      byModel[key].inputTokens += r.input_tokens ?? 0;
      byModel[key].outputTokens += r.output_tokens ?? 0;
    }

    // By agent
    const byAgent: Record<string, { requests: number; cost: number; toolCalls: number }> = {};
    for (const r of records) {
      const key = r.agent_id ?? "unknown";
      if (!byAgent[key]) byAgent[key] = { requests: 0, cost: 0, toolCalls: 0 };
      byAgent[key].requests++;
      byAgent[key].cost += Number(r.cost_usd ?? 0);
      byAgent[key].toolCalls += r.tool_calls ?? 0;
    }

    // By day (last 7 days)
    const byDay: Record<string, { requests: number; cost: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      byDay[day] = { requests: 0, cost: 0 };
    }
    for (const r of records) {
      const day = r.created_at.slice(0, 10);
      if (byDay[day]) {
        byDay[day].requests++;
        byDay[day].cost += Number(r.cost_usd ?? 0);
      }
    }

    // Today's stats
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRecords = records.filter(r => r.created_at.slice(0, 10) === todayStr);
    const todayCost = todayRecords.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
    const todayRequests = todayRecords.length;

    return Response.json({
      total: {
        cost: totalCost,
        requests: totalRequests,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        toolCalls: totalToolCalls,
      },
      today: {
        cost: todayCost,
        requests: todayRequests,
      },
      byModel,
      byAgent,
      byDay,
      recent: records.slice(0, 20),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
