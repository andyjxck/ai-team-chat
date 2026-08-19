import { tool } from "ai";
import { z } from "zod";
import { google } from "googleapis";
import { getAuthenticatedClient } from "../google/auth";

export const gmailSend = tool({
  description:
    "Send an email via Gmail. ALWAYS confirm the email content with the user before sending. Never send without explicit confirmation.",
  inputSchema: z.object({
    to: z.string().email().describe("Recipient email address"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body (plain text)"),
    cc: z.string().optional().describe("CC email address(es), comma-separated"),
    bcc: z.string().optional().describe("BCC email address(es), comma-separated"),
  }),
  execute: async ({ to, subject, body, cc, bcc }) => {
    try {
      const auth = await getAuthenticatedClient();
      const gmail = google.gmail({ version: "v1", auth });

      const emailLines = [
        `To: ${to}`,
        cc ? `Cc: ${cc}` : "",
        bcc ? `Bcc: ${bcc}` : "",
        `Subject: ${subject}`,
        "",
        body,
      ].filter(Boolean);

      const email = emailLines.join("\n");
      const encodedEmail = Buffer.from(email).toString("base64url");

      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedEmail },
      });

      return { success: true, messageId: res.data.id, to, subject };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Gmail API failed" };
    }
  },
});

export const gmailSearch = tool({
  description:
    "Search Gmail inbox. Returns matching messages with snippet previews. Use Gmail search operators (e.g. 'from:someone@example.com', 'subject:hello', 'is:unread').",
  inputSchema: z.object({
    query: z.string().describe("Gmail search query"),
    maxResults: z.number().optional().default(10).describe("Max results (1-50)"),
  }),
  execute: async ({ query, maxResults }) => {
    try {
      const auth = await getAuthenticatedClient();
      const gmail = google.gmail({ version: "v1", auth });

      const listRes = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: Math.min(maxResults, 50),
      });

      const messageIds = listRes.data.messages ?? [];
      if (messageIds.length === 0) {
        return { messages: [], count: 0 };
      }

      // Fetch details for each message
      const messages = await Promise.all(
        messageIds.slice(0, maxResults).map(async (m) => {
          const detail = await gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });

          const headers = detail.data.payload?.headers ?? [];
          const from = headers.find((h) => h.name === "From")?.value ?? "";
          const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
          const date = headers.find((h) => h.name === "Date")?.value ?? "";

          return {
            id: detail.data.id,
            from,
            subject,
            date,
            snippet: detail.data.snippet ?? "",
          };
        }),
      );

      return { messages, count: messages.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Gmail API failed" };
    }
  },
});

export const gmailRead = tool({
  description:
    "Read the full content of a specific email by its message ID. Use this after searching to read the full message.",
  inputSchema: z.object({
    messageId: z.string().describe("The Gmail message ID to read"),
  }),
  execute: async ({ messageId }) => {
    try {
      const auth = await getAuthenticatedClient();
      const gmail = google.gmail({ version: "v1", auth });

      const detail = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const headers = detail.data.payload?.headers ?? [];
      const from = headers.find((h) => h.name === "From")?.value ?? "";
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
      const date = headers.find((h) => h.name === "Date")?.value ?? "";

      // Extract body text
      let body = "";
      const payload = detail.data.payload;
      if (payload?.body?.data) {
        body = Buffer.from(payload.body.data, "base64url").toString("utf-8");
      } else if (payload?.parts) {
        const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
        }
      }

      return {
        id: detail.data.id,
        from,
        subject,
        date,
        body: body.slice(0, 10000),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Gmail API failed" };
    }
  },
});
