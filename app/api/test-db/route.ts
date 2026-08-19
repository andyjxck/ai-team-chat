import { supabase } from "@/db/client";

export async function GET() {
  try {
    const { data, error } = await supabase.from("agents").select("*").limit(1);
    if (error) throw error;
    return Response.json({ ok: true, count: data?.length, first: data?.[0]?.name });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : "unknown",
    }, { status: 500 });
  }
}
