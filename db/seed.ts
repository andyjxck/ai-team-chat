import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db, schema } from "./client";
import { AGENT_CONFIGS } from "../agents/config";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  // ─── Seed agents ───
  for (const config of AGENT_CONFIGS) {
    const existing = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, config.id));

    if (existing.length > 0) {
      await db
        .update(schema.agents)
        .set({
          name: config.name,
          role: config.role,
          avatar: config.avatar,
          persona: config.persona,
          tools: config.tools,
          model: config.model ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.agents.id, config.id));
      console.log(`  Updated agent: ${config.name}`);
    } else {
      await db
        .insert(schema.agents)
        .values({
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

  // ─── Seed default chats if none exist ───
  const existingChats = await db.select().from(schema.chats);
  if (existingChats.length > 0) {
    console.log("  Chats already exist, skipping chat seeding.");
    console.log("Done.");
    process.exit(0);
  }

  // Create 7 DM chats (one per agent)
  for (const config of AGENT_CONFIGS) {
    const chatId = `dm-${config.id}`;
    await db.insert(schema.chats).values({
      id: chatId,
      name: config.name,
      type: "dm",
      routingMode: "mentioned_only",
      isDefault: true,
    });
    await db.insert(schema.chatMembers).values({
      chatId,
      agentId: config.id,
    });
    console.log(`  Created DM chat: ${config.name}`);
  }

  // Create "All Team" group chat
  const allTeamId = "all-team";
  await db.insert(schema.chats).values({
    id: allTeamId,
    name: "All Team",
    type: "group",
    routingMode: "mentioned_only",
    isDefault: true,
  });
  for (const config of AGENT_CONFIGS) {
    await db.insert(schema.chatMembers).values({
      chatId: allTeamId,
      agentId: config.id,
    });
  }
  console.log('  Created group chat: "All Team"');

  console.log("Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
