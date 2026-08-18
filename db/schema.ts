import { pgTable, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Users ───
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  isHuman: boolean("is_human").notNull().default(true),
  agentId: text("agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Agents ───
export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  avatar: text("avatar"),
  persona: text("persona").notNull(),
  tools: jsonb("tools").$type<string[]>().notNull().default([]),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Chats ───
export const chats = pgTable("chats", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'dm' | 'group'
  routingMode: text("routing_mode").notNull().default("mentioned_only"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Chat Members (which agents are in each chat) ───
export const chatMembers = pgTable("chat_members", {
  chatId: text("chat_id").notNull(),
  agentId: text("agent_id").notNull(),
});

// ─── Messages ───
export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  senderId: text("sender_id").notNull(),
  senderType: text("sender_type").notNull(), // 'human' | 'agent'
  content: text("content").notNull(),
  mentions: jsonb("mentions").$type<string[]>().default([]),
  parentMessageId: text("parent_message_id"),
  toolCalls: jsonb("tool_calls").$type<ToolCallRecord[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type ToolCallRecord = {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

// ─── Memory (per-agent persistent notes) ───
export const memory = pgTable("memory", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Leads (Leo's CRM) ───
export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  source: text("source"),
  notes: text("notes"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Contacts (Ray's contact book) ───
export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Reminders (Eve's reminders) ───
export const reminders = pgTable("reminders", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Social Posts (log of posts made by Maya) ───
export const socialPosts = pgTable("social_posts", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  externalId: text("external_id"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Google OAuth Tokens ───
export const googleTokens = pgTable("google_tokens", {
  id: text("id").primaryKey().default("singleton"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── LinkedIn Tokens ───
export const linkedinTokens = pgTable("linkedin_tokens", {
  id: text("id").primaryKey().default("singleton"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── Types ───
export type Agent = typeof agents.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type ChatMember = typeof chatMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type User = typeof users.$inferSelect;
