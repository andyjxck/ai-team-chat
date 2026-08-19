import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { AGENT_CONFIGS } from "../agents/config";
import { nanoid } from "nanoid";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function seed() {
  console.log("Seeding database...");

  for (const config of AGENT_CONFIGS) {
    const { data: existing } = await supabase.from("agents").select("*").eq("id", config.id);

    if (existing && existing.length > 0) {
      await supabase.from("agents").update({
        name: config.name,
        role: config.role,
        avatar: config.avatar,
        persona: config.persona,
        tools: config.tools,
        model: config.model ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", config.id);
      console.log(`  Updated agent: ${config.name}`);
    } else {
      await supabase.from("agents").insert({
        id: config.id,
        name: config.name,
        role: config.role,
        avatar: config.avatar,
        persona: config.persona,
        tools: config.tools,
        model: config.model ?? null,
      });
      console.log(`  Created agent: ${config.name}`);
    }
  }

  const { data: existingChats } = await supabase.from("chats").select("*");
  if (existingChats && existingChats.length > 0) {
    console.log("  Chats already exist, skipping.");
    console.log("Done.");
    process.exit(0);
  }

  // Create DM chats for non-coding agents (coders share a group chat)
  const nonCodingAgentIds = ["maya", "leo", "sally", "evie", "lex"];
  for (const config of AGENT_CONFIGS) {
    if (!nonCodingAgentIds.includes(config.id)) continue;
    const chatId = `dm-${config.id}`;
    await supabase.from("chats").insert({
      id: chatId,
      name: config.name,
      type: "dm",
      routing_mode: "mentioned_only",
      is_default: true,
    });
    await supabase.from("chat_members").insert({ chat_id: chatId, agent_id: config.id });
    console.log(`  Created DM chat: ${config.name}`);
  }

  // Create coding team group chat (Zack, Kevin, Beepbop — no individual DMs)
  const codingTeamId = "coding-team";
  const codingAgentIds = ["zack", "kevin", "beepbop"];
  await supabase.from("chats").insert({
    id: codingTeamId,
    name: "Coding Team",
    type: "group",
    routing_mode: "mentioned_only",
    is_default: true,
  });
  for (const agentId of codingAgentIds) {
    await supabase.from("chat_members").insert({ chat_id: codingTeamId, agent_id: agentId });
  }
  console.log('  Created group chat: "Coding Team" (Zack, Kevin, Beepbop)');

  // All Team — only Zack from the coding team (he represents all 3)
  const allTeamId = "all-team";
  await supabase.from("chats").insert({
    id: allTeamId,
    name: "All Team",
    type: "group",
    routing_mode: "mentioned_only",
    is_default: true,
  });
  const allTeamAgentIds = ["maya", "leo", "sally", "evie", "lex", "zack"];
  for (const agentId of allTeamAgentIds) {
    await supabase.from("chat_members").insert({ chat_id: allTeamId, agent_id: agentId });
  }
  console.log('  Created group chat: "All Team" (Maya, Leo, Sally, Evie, Lex, Zack)');

  console.log("Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
