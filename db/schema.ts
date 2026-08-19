// Re-export types for backward compatibility
// Components use Client* types (camelCase), server uses raw types (snake_case)
export type {
  Agent,
  Chat,
  ChatMember,
  Message,
  ToolCallRecord,
  MemoryEntry,
  Lead,
  Contact,
  Reminder,
  SocialPost,
  GoogleToken,
} from "./schema-types";

export type {
  ClientAgent,
  ClientChat,
  ClientMessage,
} from "./client-types";

export type { ToolCallRecord as ClientToolCallRecord } from "./client-types";
