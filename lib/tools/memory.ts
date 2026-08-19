import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const memorySave = tool({
  description:
    "Save a note to your persistent memory. Use this to remember user preferences, context, or important details for future conversations.",
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

export const memoryLoad = tool({
  description:
    "Load notes from your persistent memory. Retrieve a specific note by key, or all notes if no key is provided.",
  inputSchema: z.object({
    key: z.string().optional().describe("The specific key to load, or omit to load all notes"),
  }),
  execute: async ({ key }) => {
    const agentId = (globalThis as Record<string, unknown>).__currentAgentId as string;
    if (!agentId) return { error: "No agent context" };

    if (key) {
      const { data } = await supabase
        .from("memory")
        .select("*")
        .eq("agent_id", agentId)
        .eq("key", key);
      return { notes: data ?? [] };
    }

    const { data } = await supabase.from("memory").select("*").eq("agent_id", agentId);
    return { notes: data ?? [] };
  },
});
