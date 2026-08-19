import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const reminderCreate = tool({
  description: "Create a reminder for a task or follow-up.",
  inputSchema: z.object({
    title: z.string(),
    dueAt: z.string().optional().describe("Due date in ISO format"),
  }),
  execute: async ({ title, dueAt }) => {
    const agentId = (globalThis as Record<string, unknown>).__currentAgentId as string;
    const id = nanoid();
    const { error } = await supabase.from("reminders").insert({
      id,
      agent_id: agentId ?? "system",
      title,
      due_at: dueAt ?? null,
      done: false,
    });
    if (error) return { error: error.message };
    return { success: true, reminderId: id, title, dueAt: dueAt ?? null };
  },
});

export const reminderList = tool({
  description: "List all reminders, optionally filtered to only pending ones.",
  inputSchema: z.object({
    pendingOnly: z.boolean().optional().default(true),
  }),
  execute: async ({ pendingOnly }) => {
    let query = supabase.from("reminders").select("*");
    if (pendingOnly) query = query.eq("done", false);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { reminders: data ?? [], count: data?.length ?? 0 };
  },
});
