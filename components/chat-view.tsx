"use client";

import { useChatManager } from "@/hooks/use-chat-manager";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import type { ClientAgent, ClientChat, ClientMessage } from "@/db/client-types";
import { Avatar, AvatarGroup } from "./avatar";

export function ChatView({
  chat,
  members,
  initialMessages,
}: {
  chat: ClientChat;
  members: ClientAgent[];
  initialMessages: ClientMessage[];
}) {
  const { messages, isStreaming, activity, sendMessage, stopStreaming } = useChatManager(
    chat,
    members,
    initialMessages
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border/50 bg-background/50 backdrop-blur-sm px-4 py-3">
        {chat.type === "group" ? (
          <AvatarGroup members={members.map(m => ({ id: m.id, avatar: m.avatar, name: m.name }))} size="sm" max={3} />
        ) : (
          <div className="relative">
            <Avatar
              id={members[0]?.id ?? "default"}
              emoji={members[0]?.avatar}
              name={members[0]?.name ?? chat.name}
              size="md"
            />
            <span className="online-indicator absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{chat.name}</h2>
          {chat.type === "group" ? (
            <p className="truncate text-xs text-muted-foreground">
              {members.map((m) => m.name).join(" · ")}
            </p>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs text-muted-foreground">{members[0]?.role}</span>
              <span className="h-1 w-1 rounded-full bg-green-500" />
              <span className="text-xs text-green-600 dark:text-green-400">online</span>
            </div>
          )}
        </div>
        {isStreaming && (
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {activity ?? "working..."}
          </div>
        )}
      </div>

      <MessageList
        messages={messages}
        chatId={chat.id}
        members={members.map(m => ({ id: m.id, name: m.name, avatar: m.avatar, role: m.role }))}
      />

      <MessageInput
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        members={members}
        chatType={chat.type}
        routingMode={chat.routingMode}
      />
    </div>
  );
}
