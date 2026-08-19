import { tool } from "ai";
import { z } from "zod";
import { getAgentConfig } from "@/agents/config";

export const messageAgent = tool({
  description:
    "Send a message to another AI team member, asking them to handle something. This signals that another agent should respond. Use this to route requests to the right person. Available agents: maya, leo, sally, evie, lex, zack, kevin, beepbop.",
  inputSchema: z.object({
    agentId: z.string().describe("The ID of the agent to message (maya, leo, sally, evie, lex, zack, kevin, beepbop)"),
    message: z.string().describe("The message to send to that agent"),
  }),
  execute: async ({ agentId, message }) => {
    const config = getAgentConfig(agentId);
    if (!config) {
      return { error: `Unknown agent: ${agentId}. Valid agents: maya, leo, sally, evie, lex, zack, kevin, beepbop` };
    }
    return {
      success: true,
      routedTo: config.name,
      message,
      note: `${config.name} has been notified. They will respond in the chat.`,
    };
  },
});
