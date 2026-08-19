import { mayaPersona } from "./personas/maya";
import { leoPersona } from "./personas/leo";
import { sallyPersona } from "./personas/sally";
import { eviePersona } from "./personas/evie";
import { lexPersona } from "./personas/lex";
import { zackPersona } from "./personas/zack";
import { kevinPersona } from "./personas/kevin";
import { beepbopPersona } from "./personas/beepbop";

export type AgentConfig = {
  id: string;
  name: string;
  role: string;
  avatar: string; // emoji
  persona: string;
  tools: string[];
  model?: string;
};

// Common GitHub tools for all agents
const GITHUB_TOOLS = [
  "github_list_repos",
  "github_list_files",
  "github_read_file",
];

// Coding tools for developers
const CODING_TOOLS = [
  ...GITHUB_TOOLS,
  "github_edit_file",
  "github_delete_file",
  "github_review",
  "github_get_commits",
  "github_create_branch",
  "github_create_pr",
  "github_create_issue",
  "github_search_code",
  "github_list_branches",
  "netlify_deploy",
  "netlify_list_deploys",
];

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: "maya",
    name: "Maya",
    role: "Social Media Manager",
    avatar: "📱",
    persona: mayaPersona,
    tools: [
      "serper_search",
      "web_fetch",
      "image_gen",
      "social_post_x",
      "draft_action",
      "memory_save",
      "ask_question",
      "proactive_message",
      ...GITHUB_TOOLS,
    ],
  },
  {
    id: "leo",
    name: "Leo",
    role: "Lead Generator",
    avatar: "🎯",
    persona: leoPersona,
    tools: [
      "serper_search",
      "web_fetch",
      "leads_create",
      "leads_update",
      "leads_list",
      "memory_save",
      "ask_question",
      "proactive_message",
      ...GITHUB_TOOLS,
    ],
  },
  {
    id: "sally",
    name: "Sally",
    role: "Website & SEO Builder",
    avatar: "🌐",
    persona: sallyPersona,
    tools: [
      "serper_search",
      "web_fetch",
      "memory_save",
      "ask_question",
      "proactive_message",
      ...GITHUB_TOOLS,
      "draft_action",
    ],
  },
  {
    id: "evie",
    name: "Evie",
    role: "Executive Assistant",
    avatar: "📋",
    persona: eviePersona,
    tools: [
      "calendar_list",
      "calendar_create",
      "calendar_update",
      "calendar_delete",
      "gmail_send",
      "gmail_search",
      "gmail_read",
      "reminder_create",
      "reminder_list",
      "contacts_create",
      "contacts_search",
      "memory_save",
      "ask_question",
      "proactive_message",
      ...GITHUB_TOOLS,
      "serper_search",
      "web_fetch",
      "app_performance_log",
      "app_performance_report",
      "message_agent",
      "draft_action",
    ],
  },
  {
    id: "lex",
    name: "Lex",
    role: "Legal Assistant",
    avatar: "⚖️",
    persona: lexPersona,
    tools: [
      "serper_search",
      "web_fetch",
      "memory_save",
      "ask_question",
      "proactive_message",
      ...GITHUB_TOOLS,
      "draft_action",
    ],
  },
  {
    id: "zack",
    name: "Zackary",
    role: "Senior Engineer",
    avatar: "⚡",
    persona: zackPersona,
    tools: [
      "serper_search",
      "web_fetch",
      "image_gen",
      "memory_save",
      "ask_question",
      "proactive_message",
      ...CODING_TOOLS,
      "draft_action",
    ],
  },
  {
    id: "kevin",
    name: "Kevin",
    role: "Software Architect",
    avatar: "🏗️",
    persona: kevinPersona,
    tools: [
      "serper_search",
      "web_fetch",
      "image_gen",
      "memory_save",
      "ask_question",
      ...CODING_TOOLS,
      "draft_action",
    ],
  },
  {
    id: "beepbop",
    name: "Beepbop",
    role: "Creative Coder",
    avatar: "🤖",
    persona: beepbopPersona,
    tools: [
      "serper_search",
      "web_fetch",
      "image_gen",
      "memory_save",
      "ask_question",
      ...CODING_TOOLS,
      "draft_action",
    ],
  },
];

export const AGENT_MAP = Object.fromEntries(
  AGENT_CONFIGS.map((a) => [a.id, a]),
);

export function getAgentConfig(id: string): AgentConfig | undefined {
  return AGENT_MAP[id];
}
