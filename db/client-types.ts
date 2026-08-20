// Client-side types (camelCase) — used by React components
// Server code maps from snake_case (Supabase) to these

export type ClientAgent = {
  id: string;
  name: string;
  role: string;
  avatar: string | null;
  persona: string;
  tools: string[];
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientChat = {
  id: string;
  name: string;
  type: "dm" | "group";
  routingMode: "mentioned_only" | "all_members";
  isDefault: boolean;
  createdAt: string;
  unreadCount: number;
};

export type ToolCallRecord = {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

export type DraftData = {
  draftId: string;
  type: "social_post" | "email" | "calendar_event" | "file_write" | "code_run" | "other";
  title: string;
  preview: string;
  actionType: string;
  actionData: Record<string, unknown>;
  agentId: string;
  status: "pending_approval" | "approved" | "rejected" | "executing" | "done" | "error";
  result?: unknown;
  error?: string;
};

export type QuestionOption = {
  label: string;
  description?: string;
};

export type QuestionData = {
  questionId: string;
  question: string;
  options: QuestionOption[];
  answered: boolean;
  selected?: string;
};

export type CodeChangeData = {
  repo: string;
  path: string;
  description: string;
  oldContent?: string;
  newContent?: string;
  changeId?: string;
  status: "pending" | "applied" | "rejected" | "rolled_back";
  agentId: string;
};

export type ClientMessage = {
  id: string;
  chatId: string;
  senderId: string;
  senderType: "human" | "agent";
  content: string;
  mentions: string[];
  parentMessageId?: string | null;
  toolCalls: ToolCallRecord[];
  createdAt: string;
  streaming?: boolean;
  agent?: ClientAgent | null;
  drafts?: DraftData[];
  questions?: QuestionData[];
  codeChanges?: CodeChangeData[];
  replyTo?: { id: string; senderName: string; content: string } | null;
};
