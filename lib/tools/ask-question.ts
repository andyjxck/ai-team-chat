import { tool } from "ai";
import { z } from "zod";

export const askQuestion = tool({
  description:
    "Ask the user a direct question with clickable options. Use this in DMs when you need the user to make a choice before proceeding. The question will appear as an interactive card with buttons the user can click, plus an 'Other' option where they can type a custom answer. Always provide 2-4 specific options — the user can always choose 'Other' to type something different. Do NOT ask open-ended questions with no options.",
  inputSchema: z.object({
    question: z.string().describe("The question to ask the user"),
    options: z.array(z.object({
      label: z.string().describe("Short button text (1-5 words)"),
      description: z.string().optional().describe("Optional longer explanation of this option, shown under the label"),
    })).min(2).max(4).describe("2-4 clickable options for the user to choose from. An 'Other' option with free text input is automatically added."),
  }),
  execute: async ({ question, options }) => {
    return {
      questionId: `q-${Date.now()}`,
      question,
      options,
      answered: false,
    };
  },
});
