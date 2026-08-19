// Type definitions matching the Postgres schema (snake_case as returned by Supabase REST API)

export type Agent = {
  id: string;
  name: string;
  role: string;
  avatar: string | null;
  persona: string;
  tools: string[];
  model: string | null;
  created_at: string;
  updated_at: string;
};

export type Chat = {
  id: string;
  name: string;
  type: "dm" | "group";
  routing_mode: "mentioned_only" | "all_members";
  is_default: boolean;
  created_at: string;
};

export type ChatMember = {
  chat_id: string;
  agent_id: string;
};

export type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_type: "human" | "agent";
  content: string;
  mentions: string[] | null;
  parent_message_id: string | null;
  tool_calls: ToolCallRecord[] | null;
  created_at: string;
};

export type ToolCallRecord = {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

export type MemoryEntry = {
  id: string;
  agent_id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
};

export type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  notes: string | null;
  status: "new" | "contacted" | "qualified" | "won" | "lost";
  created_at: string;
  updated_at: string;
};

export type Contact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

export type Reminder = {
  id: string;
  agent_id: string;
  title: string;
  due_at: string | null;
  done: boolean;
  created_at: string;
};

export type SocialPost = {
  id: string;
  platform: string;
  content: string;
  media_url: string | null;
  external_id: string | null;
  status: "draft" | "posted" | "failed";
  created_at: string;
};

export type GoogleToken = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  updated_at: string;
};
