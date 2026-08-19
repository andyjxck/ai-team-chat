import { tool } from "ai";
import { z } from "zod";
import { supabase } from "@/db/client";
import { getAgentConfig } from "@/agents/config";

export const proactiveMessage = tool({
  description:
    "Send a proactive message to the user in a chat. The agent can reach out first without the user asking. BUT: if the agent already sent a message and the user hasn't replied yet, this will be blocked — no double-sending. Use this when you have something important to tell the user (e.g. an appointment reminder, a lead you found, a bug you fixed).",
  inputSchema: z.object({
    chatId: z.string().describe("The chat ID to send the message to (e.g. 'dm-eve', 'all-team', 'coding-team')"),
    message: z.string().describe("The message to send to the user"),
  }),
  execute: async ({ chatId, message }) => {
    try {
      // Get the current agent ID from the global
      const agentId = (globalThis as Record<string, unknown>).__currentAgentId as string;
      if (!agentId) {
        return { error: "No agent context available" };
      }

      const config = getAgentConfig(agentId);
      if (!config) {
        return { error: "Unknown agent" };
      }

      // Check: has the user replied since the agent's last message in this chat?
      const { data: recentMessages } = await supabase
        .from("messages")
        .select("sender_id, sender_type, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (recentMessages && recentMessages.length > 0) {
        // Find the last message from this agent
        const lastAgentMsgIndex = recentMessages.findIndex(
          (m) => m.sender_id === agentId && m.sender_type === "agent",
        );

        if (lastAgentMsgIndex !== -1) {
          // Check if there's a human message AFTER the agent's last message
          // (recentMessages is sorted desc, so "after" means lower index)
          const hasUserReplied = recentMessages
            .slice(0, lastAgentMsgIndex)
            .some((m) => m.sender_type === "human");

          if (!hasUserReplied) {
            return {
              blocked: true,
              reason: "You already sent a message and the user hasn't replied yet. No double-sending.",
            };
          }
        }
      }

      // Send the message
      const messageId = `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await supabase.from("messages").insert({
        id: messageId,
        chat_id: chatId,
        sender_id: agentId,
        sender_type: "agent",
        content: message,
        mentions: [],
      });

      return {
        success: true,
        chatId,
        messageId,
        message: `Sent proactive message to ${chatId}`,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to send proactive message" };
    }
  },
});
