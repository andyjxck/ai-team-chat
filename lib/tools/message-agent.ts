import { tool } from "ai";
import { z } from "zod";
import { getAgentConfig } from "@/agents/config";

export const messageAgent = tool({
  description:
    "Send a message to another AI team member, asking them to handle something. This triggers that agent to respond in the current chat. Use this to route requests to the right person.",
  inputSchema: z.object({
    agentId: z.string().describe("The ID of the agent to message (e.g. 'maya', 'leo', 'wade', 'sage', 'eve', 'lex')"),
    message: z.string().describe("The message to send to that agent"),
  }),
  execute: async ({ agentId, message }) => {
    const config = getAgentConfig(agentId);
    if (!config) {
      return { error: `Unknown agent: ${agentId}` };
    }
    // The actual routing is handled by the orchestrator — this just signals intent
    // The orchestrator will pick up the queued message and trigger the target agent
    return {
      success: true,
      routedTo: config.name,
      message,
      note: `${config.name} will respond to this. The message has been forwarded.`,
    };
  },
});
