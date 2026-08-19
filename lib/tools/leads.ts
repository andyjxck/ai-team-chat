import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const leadsCreate = tool({
  description: "Save a new lead to the CRM.",
  inputSchema: z.object({
    name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    company: z.string().optional(),
    source: z.string(),
    notes: z.string().optional(),
  }),
  execute: async ({ name, email, phone, company, source, notes }) => {
    const id = nanoid();
    const { error } = await supabase.from("leads").insert({
      id,
      name,
      email: email ?? null,
      phone: phone ?? null,
      company: company ?? null,
      source,
      notes: notes ?? null,
      status: "new",
    });
    if (error) return { error: error.message };
    return { success: true, leadId: id, name, status: "new" };
  },
});

export const leadsUpdate = tool({
  description: "Update a lead's status or information in the CRM.",
  inputSchema: z.object({
    leadId: z.string(),
    status: z.enum(["new", "contacted", "qualified", "won", "lost"]).optional(),
    notes: z.string().optional(),
  }),
  execute: async ({ leadId, status, notes }) => {
    const { data } = await supabase.from("leads").select("*").eq("id", leadId);
    if (!data || data.length === 0) return { error: "Lead not found" };

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) update.status = status;
    if (notes) update.notes = notes;

    const { error } = await supabase.from("leads").update(update).eq("id", leadId);
    if (error) return { error: error.message };
    return { success: true, leadId, status };
  },
});

export const leadsList = tool({
  description: "List leads from the CRM, optionally filtered by status.",
  inputSchema: z.object({
    status: z.enum(["new", "contacted", "qualified", "won", "lost"]).optional(),
  }),
  execute: async ({ status }) => {
    let query = supabase.from("leads").select("*");
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return { leads: data ?? [], count: data?.length ?? 0 };
  },
});
