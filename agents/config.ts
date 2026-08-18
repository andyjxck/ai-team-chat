import { mayaPersona } from "./personas/maya";
import { leoPersona } from "./personas/leo";
import { wadePersona } from "./personas/wade";
import { sagePersona } from "./personas/sage";
import { evePersona } from "./personas/eve";
import { rayPersona } from "./personas/ray";
import { lexPersona } from "./personas/lex";

export type AgentConfig = {
  id: string;
  name: string;
  role: string;
  avatar: string; // emoji
  persona: string;
  tools: string[];
  model?: string;
};

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
      "social_post_linkedin",
      "social_post_instagram",
      "social_post_facebook",
      "file_write",
      "memory_save",
      "memory_load",
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
      "memory_load",
      "file_write",
    ],
  },
  {
    id: "wade",
    name: "Wade",
    role: "Website Builder",
    avatar: "🔧",
    persona: wadePersona,
    tools: [
      "serper_search",
      "web_fetch",
      "file_read",
      "file_write",
      "file_list",
      "code_exec",
      "memory_save",
      "memory_load",
    ],
  },
  {
    id: "sage",
    name: "Sage",
    role: "SEO Expert",
    avatar: "🔍",
    persona: sagePersona,
    tools: [
      "serper_search",
      "web_fetch",
      "file_write",
      "memory_save",
      "memory_load",
    ],
  },
  {
    id: "eve",
    name: "Eve",
    role: "Executive Assistant",
    avatar: "📋",
    persona: evePersona,
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
      "memory_save",
      "memory_load",
      "file_read",
      "serper_search",
    ],
  },
  {
    id: "ray",
    name: "Ray",
    role: "Receptionist",
    avatar: "👋",
    persona: rayPersona,
    tools: [
      "contacts_create",
      "contacts_search",
      "memory_save",
      "memory_load",
      "message_agent",
      "reminder_create",
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
      "file_read",
      "file_write",
      "memory_save",
      "memory_load",
    ],
  },
];

export const AGENT_MAP = Object.fromEntries(
  AGENT_CONFIGS.map((a) => [a.id, a]),
);

export function getAgentConfig(id: string): AgentConfig | undefined {
  return AGENT_MAP[id];
}
