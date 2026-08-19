import { useState, useCallback, useRef } from "react";
import type { ClientMessage, ClientAgent, ClientChat } from "@/db/client-types";

const SYSTEM_AGENT: ClientAgent = {
  id: "system",
  name: "System",
  role: "",
  avatar: "⚠️",
  persona: "",
  tools: [],
  model: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

type StreamingEvent =
  | { type: "agent_start"; agentId: string }
  | { type: "agent_skip"; agentId: string; name: string }
  | { type: "token"; agentId: string; text: string }
  | { type: "tool_call"; agentId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; agentId: string; tool: string; result: unknown; error?: string }
  | { type: "message_end"; agentId: string; messageId: string; content: string }
  | { type: "heartbeat"; tool: string }
  | { type: "error"; message: string };

const TOOL_ACTIVITIES: Record<string, (args: Record<string, unknown>) => string> = {
  github_read_file: (a) => `reading ${a.path ?? "files"}`,
  github_list_files: (a) => `browsing ${a.path ?? "files"}`,
  github_list_repos: () => "listing repositories",
  github_edit_file: (a) => `editing ${a.path ?? "code"}`,
  github_delete_file: (a) => `deleting ${a.path ?? "a file"}`,
  github_review: () => "reviewing code",
  github_get_commits: () => "checking git history",
  github_create_branch: (a) => `creating branch ${a.branch ?? ""}`,
  github_create_pr: (a) => `creating PR: ${a.title ?? ""}`,
  github_create_issue: (a) => `creating issue: ${a.title ?? ""}`,
  github_search_code: (a) => `searching code for "${a.query ?? ""}"`,
  github_list_branches: () => "listing branches",
  netlify_deploy: () => "checking deploy status",
  netlify_list_deploys: () => "checking deploy status",
  serper_search: (a) => `searching the web${a.query ? ` for "${String(a.query).slice(0, 40)}"` : ""}`,
  web_fetch: () => "fetching a web page",
  image_gen: () => "generating an image",
  social_post_x: () => "posting to X",
  gmail_send: () => "sending an email",
  gmail_search: () => "searching emails",
  gmail_read: () => "reading an email",
  calendar_create: () => "creating a calendar event",
  calendar_list: () => "checking calendar",
  memory_save: () => "saving to memory",
  draft_action: () => "preparing a draft",
  message_agent: (a) => `messaging ${a.agentId ?? "an agent"}`,
};

export function useChatManager(
  chat: ClientChat,
  members: ClientAgent[],
  initialMessages: ClientMessage[]
) {
  const [messages, setMessages] = useState<ClientMessage[]>(
    initialMessages.map((m) => ({
      ...m,
      mentions: m.mentions ?? [],
      toolCalls: m.toolCalls ?? [],
      agent: members.find((a) => a.id === m.senderId) ?? null,
    }))
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const upsertStreamingMessage = useCallback(
    (agentId: string, updater: (msg: ClientMessage) => ClientMessage) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.senderId === agentId && m.streaming);
        if (idx === -1) {
          const agent = members.find((a) => a.id === agentId) ?? null;
          const newMsg: ClientMessage = {
            id: `streaming-${agentId}-${Date.now()}`,
            chatId: chat.id,
            senderId: agentId,
            senderType: "agent",
            content: "",
            mentions: [],
            toolCalls: [],
            createdAt: new Date().toISOString(),
            streaming: true,
            agent,
          };
          return [...prev, updater(newMsg)];
        }
        const updated = [...prev];
        updated[idx] = updater(updated[idx]);
        return updated;
      });
    },
    [chat.id, members]
  );

  const sendMessage = useCallback(async (text: string, mentions: string[], replyToAgentId?: string) => {
    const humanMsg: ClientMessage = {
      id: `temp-${Date.now()}`,
      chatId: chat.id,
      senderId: "local-user",
      senderType: "human",
      content: text,
      mentions,
      toolCalls: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev.filter((m) => !m.streaming), humanMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chat.id, content: text, mentions, replyToAgentId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            chatId: chat.id,
            senderId: "system",
            senderType: "agent",
            content: `Error: ${errText}`,
            mentions: [],
            toolCalls: [],
            createdAt: new Date().toISOString(),
            agent: SYSTEM_AGENT,
          },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const event: StreamingEvent = JSON.parse(data);

            switch (event.type) {
              case "agent_start":
                upsertStreamingMessage(event.agentId, (m) => m);
                break;
              case "agent_skip":
                setMessages((prev) => prev.filter((m) => !(m.senderId === event.agentId && m.streaming)));
                break;
              case "token":
                upsertStreamingMessage(event.agentId, (m) => ({
                  ...m,
                  content: m.content + event.text,
                }));
                break;
              case "tool_call":
                upsertStreamingMessage(event.agentId, (m) => {
                  const toolCalls = [...(m.toolCalls ?? [])];
                  toolCalls.push({
                    tool: event.tool,
                    args: event.args,
                  });
                  return { ...m, toolCalls };
                });
                {
                  const agent = members.find((a) => a.id === event.agentId);
                  const activityFn = TOOL_ACTIVITIES[event.tool];
                  if (agent && activityFn) {
                    setActivity(`${agent.name} is ${activityFn(event.args)}...`);
                  }
                }
                break;
              case "tool_result":
                upsertStreamingMessage(event.agentId, (m) => {
                  const toolCalls = (m.toolCalls ?? []).map((tc, i) =>
                    i === (m.toolCalls ?? []).length - 1
                      ? { ...tc, result: event.result, error: event.error }
                      : tc
                  );
                  return { ...m, toolCalls };
                });
                break;
              case "message_end":
                upsertStreamingMessage(event.agentId, (m) => ({
                  ...m,
                  id: event.messageId,
                  content: event.content,
                  streaming: false,
                }));
                setActivity(null);
                break;
              case "error":
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `err-${Date.now()}`,
                    chatId: chat.id,
                    senderId: "system",
                    senderType: "agent",
                    content: event.message,
                    mentions: [],
                    toolCalls: [],
                    createdAt: new Date().toISOString(),
                    agent: SYSTEM_AGENT,
                  },
                ]);
                break;
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          chatId: chat.id,
          senderId: "system",
          senderType: "agent",
          content: `Error: ${err instanceof Error ? err.message : "Something went wrong"}`,
          mentions: [],
          toolCalls: [],
          createdAt: new Date().toISOString(),
          agent: SYSTEM_AGENT,
        },
      ]);
    } finally {
      setIsStreaming(false);
      setActivity(null);
      abortRef.current = null;
    }
  }, [chat.id, members, upsertStreamingMessage]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    isStreaming,
    activity,
    sendMessage,
    stopStreaming,
  };
}
