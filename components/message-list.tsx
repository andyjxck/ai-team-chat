"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "./message-bubble";
import type { ClientMessage } from "./chat-view";

export function MessageList({ messages }: { messages: ClientMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center py-20 text-center text-muted-foreground">
            <div>
              <p className="text-lg font-medium">No messages yet</p>
              <p className="text-sm">Start the conversation below.</p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
