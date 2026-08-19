import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const contactsCreate = tool({
  description: "Save a new contact to the contact book.",
  inputSchema: z.object({
    name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    notes: z.string().optional(),
  }),
  execute: async ({ name, email, phone, notes }) => {
    const id = nanoid();
    const { error } = await supabase.from("contacts").insert({
      id,
      name,
      email: email ?? null,
      phone: phone ?? null,
      notes: notes ?? null,
    });
    if (error) return { error: error.message };
    return { success: true, contactId: id, name };
  },
});

export const contactsSearch = tool({
  description: "Search the contact book by name, email, or phone.",
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    const [{ data: byName }, { data: byEmail }, { data: byPhone }] = await Promise.all([
      supabase.from("contacts").select("*").ilike("name", `%${query}%`),
      supabase.from("contacts").select("*").ilike("email", `%${query}%`),
      supabase.from("contacts").select("*").ilike("phone", `%${query}%`),
    ]);

    const all = [...(byName ?? []), ...(byEmail ?? []), ...(byPhone ?? [])];
    const seen = new Set<string>();
    const contacts = all.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    return { contacts, count: contacts.length };
  },
});
