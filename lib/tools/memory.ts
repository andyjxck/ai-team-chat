import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const memorySave = tool({
  description:
    "Save a note to your persistent memory. Your existing memories are already loaded into your context — you don't need to load them. Use this only to SAVE new memories or update existing ones.",
  inputSchema: z.object({
    key: z.string().describe("A short key to identify this memory"),
    value: z.string().describe("The content to remember"),
  }),
  execute: async ({ key, value }) => {
    const agentId = (globalThis as Record<string, unknown>).__currentAgentId as string;
    if (!agentId) return { error: "No agent context" };

    const { data: existing } = await supabase
      .from("memory")
      .select("*")
      .eq("agent_id", agentId)
      .eq("key", key);

    if (existing && existing.length > 0) {
      await supabase
        .from("memory")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("id", existing[0].id);
    } else {
      await supabase.from("memory").insert({
        id: nanoid(),
        agent_id: agentId,
        key,
        value,
      });
    }

    return { success: true, key, value };
  },
});

// Server-side helper: load all memories for an agent (used to inject into system prompt)
export async function loadAgentMemory(agentId: string): Promise<string> {
  const { data } = await supabase
    .from("memory")
    .select("key, value")
    .eq("agent_id", agentId);

  if (!data || data.length === 0) return "";

  const lines = data.map((m: { key: string; value: string }) => `- ${m.key}: ${m.value}`);
  return `\n## Your Memories (auto-loaded)\n${lines.join("\n")}\n`;
}
