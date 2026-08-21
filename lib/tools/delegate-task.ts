import { tool } from "ai";
import { z } from "zod";

export const delegateTask = tool({
  description:
    "Delegate a sub-task or question to another specialized agent. Use this when you need another team member's expertise. The target agent will receive your message and respond in the same chat.",
  inputSchema: z.object({
    targetAgentId: z
      .enum(["zack", "kevin", "beepbop", "maya", "leo", "sally", "evie", "lex"])
      .describe("The agent to delegate to"),
    taskDescription: z
      .string()
      .describe("Specific context and instructions for the target agent. Include what you need from them and why."),
  }),
  execute: async ({ targetAgentId, taskDescription }) => {
    return {
      delegated: true,
      to: targetAgentId,
      task: taskDescription,
    };
  },
});
