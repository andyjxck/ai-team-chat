import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { nanoid } from "nanoid";

export const draftAction = tool({
  description:
    "Create a draft for user approval before executing an action. Use this BEFORE posting to social media, sending emails, or making any irreversible change. The draft shows a preview card with approve/reject buttons. Only proceed with the actual action after the user approves.",
  inputSchema: z.object({
    type: z.enum(["social_post", "email", "calendar_event", "file_write", "code_run", "other"]).describe("The type of action being drafted"),
    title: z.string().describe("Short title for the draft card, e.g. 'Post to X' or 'Email to john@example.com'"),
    preview: z.string().describe("The full content to preview — the tweet text, email body, event details, code, etc."),
    actionData: z.record(z.unknown()).describe("The data needed to execute the action if approved (e.g. {platform: 'x', text: '...'} or {to: '...', subject: '...', body: '...'})"),
    actionType: z.string().describe("The tool name to execute if approved, e.g. 'social_post_x' or 'gmail_send'"),
  }),
  execute: async ({ type, title, preview, actionData, actionType }) => {
    const agentId = (globalThis as Record<string, unknown>).__currentAgentId as string;
    const id = nanoid();

    // Store the draft in the database (we'll use a dedicated table or memory)
    // For now, return the draft info — the frontend will show the preview card
    return {
      draftId: id,
      type,
      title,
      preview,
      actionType,
      actionData,
      agentId,
      status: "pending_approval",
      message: "Draft created. Waiting for user approval before executing.",
    };
  },
});
