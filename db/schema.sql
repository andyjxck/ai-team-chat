-- AI Team Chat — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor if tables don't exist

-- Agents
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar TEXT,
  persona TEXT NOT NULL,
  tools JSONB NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chats
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  routing_mode TEXT NOT NULL DEFAULT 'mentioned_only',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chat Members
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (chat_id, agent_id)
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  content TEXT NOT NULL,
  mentions JSONB DEFAULT '[]',
  parent_message_id TEXT,
  tool_calls JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Memory
CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  source TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reminders
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Social Posts
CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  content TEXT NOT NULL,
  media_url TEXT,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Google Tokens
CREATE TABLE IF NOT EXISTS google_tokens (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- App Performance (iOS App Store tracking)
CREATE TABLE IF NOT EXISTS app_performance (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  app_id TEXT,
  app_name TEXT,
  downloads INTEGER DEFAULT 0,
  revenue DECIMAL(10,2) DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  page_views INTEGER DEFAULT 0,
  crashes INTEGER DEFAULT 0,
  ratings_new INTEGER DEFAULT 0,
  ratings_avg DECIMAL(2,1),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GitHub Repos (which repos the user has opened for agent access)
CREATE TABLE IF NOT EXISTS github_repos (
  user_id TEXT NOT NULL,
  repo_id BIGINT NOT NULL,
  repo_name TEXT NOT NULL,
  owner TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages (chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id ON chat_members (chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_agent_id ON chat_members (agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_agent_id ON memory (agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_reminders_agent_id ON reminders (agent_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due_at ON reminders (due_at);

