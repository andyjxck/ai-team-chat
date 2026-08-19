"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "./message-bubble";
import { DraftCard } from "./draft-card";
import { QuestionCard } from "./question-card";
import { Avatar } from "./avatar";
import type { ClientMessage, DraftData, QuestionData } from "@/db/client-types";

function getDateLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msgDate = new Date(date);
  msgDate.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return msgDate.toLocaleDateString(undefined, { weekday: "long" });
  return msgDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: msgDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function MessageList({
  messages,
  onReply,
  onDraftUpdate,
  onQuestionAnswer,
  chatId,
  members,
}: {
  messages: ClientMessage[];
  onReply?: (msg: ClientMessage) => void;
  onDraftUpdate?: (msgId: string, draft: DraftData) => void;
  onQuestionAnswer?: (msgId: string, questionId: string, answer: string) => void;
  chatId: string;
  members?: { id: string; name: string; avatar: string | null; role: string }[];
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-1">
        {messages.length === 0 && members && members.length > 0 && (
          <EmptyState members={members} chatId={chatId} />
        )}
        {messages.length === 0 && (!members || members.length === 0) && (
          <div className="flex h-full items-center justify-center py-20 text-center text-muted-foreground">
            <div>
              <p className="text-lg font-medium">No messages yet</p>
              <p className="text-sm">Start the conversation below.</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];

          // Date separator
          const showDateSeparator = !prev || !isSameDay(prev.createdAt, msg.createdAt);

          // Message grouping: group consecutive messages from same sender within 5 minutes
          const isGroupedWithPrev = prev &&
            prev.senderId === msg.senderId &&
            prev.senderType === msg.senderType &&
            !showDateSeparator &&
            (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000;

          const isGroupedWithNext = next &&
            next.senderId === msg.senderId &&
            next.senderType === msg.senderType &&
            isSameDay(msg.createdAt, next.createdAt) &&
            (new Date(next.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 5 * 60 * 1000;

          return (
            <div key={msg.id}>
              {showDateSeparator && (
                <div className="flex items-center justify-center py-3">
                  <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {getDateLabel(new Date(msg.createdAt))}
                  </span>
                </div>
              )}
              <div className={isGroupedWithPrev ? "mt-0.5" : "mt-3"}>
                <MessageBubble
                  message={msg}
                  onReply={onReply}
                  grouped={isGroupedWithPrev ? "continued" : isGroupedWithNext ? "first" : undefined}
                />
                {/* Question cards */}
                {msg.questions && msg.questions.length > 0 && (
                  <div className="ml-11 space-y-2">
                    {msg.questions.map((q) => (
                      <QuestionCard
                        key={q.questionId}
                        question={q}
                        onSelect={(answer) => onQuestionAnswer?.(msg.id, q.questionId, answer)}
                      />
                    ))}
                  </div>
                )}
                {/* Draft cards */}
                {msg.drafts && msg.drafts.length > 0 && (
                  <div className="ml-11 space-y-2">
                    {msg.drafts.map((draft) => (
                      <DraftCard
                        key={draft.draftId}
                        draft={draft}
                        chatId={chatId}
                        onUpdate={(updated) => onDraftUpdate?.(msg.id, updated)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function EmptyState({ members, chatId }: { members: { id: string; name: string; avatar: string | null; role: string }[]; chatId: string }) {
  const isGroup = members.length > 1;
  const isCodingTeam = chatId === "coding-team";

  return (
    <div className="flex h-full flex-col items-center justify-center py-20 text-center animate-fade-in">
      {/* Avatar display */}
      <div className="mb-4 flex -space-x-2">
        {members.slice(0, 4).map((m) => (
          <Avatar
            key={m.id}
            id={m.id}
            emoji={m.avatar}
            name={m.name}
            size="lg"
          />
        ))}
        {members.length > 4 && (
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-background bg-muted text-sm font-semibold">
            +{members.length - 4}
          </div>
        )}
      </div>

      <h2 className="text-xl font-bold mb-1">
        {isGroup ? (isCodingTeam ? "Coding Team" : "Group Chat") : members[0]?.name}
      </h2>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm">
        {isCodingTeam
          ? "Zack, Kevin, and Beepbop — your autonomous coding team. Ask them to review, fix, or build anything. They'll read the code, make changes, and deploy."
          : isGroup
            ? `Chat with ${members.map(m => m.name).join(", ")}. Use @ to mention someone specific.`
            : `${members[0]?.role} — ready to help. Just send a message.`}
      </p>

      {/* Quick suggestions */}
      <div className="flex flex-wrap gap-2 justify-center max-w-md">
        {isCodingTeam ? (
          <>
            <Suggestion text="Review the ai-team-chat repo for bugs" />
            <Suggestion text="Fix any issues you find and deploy" />
            <Suggestion text="What can you improve?" />
          </>
        ) : isGroup ? (
          <>
            <Suggestion text="Hey team, what's the status?" />
            <Suggestion text="Can someone help me with something?" />
          </>
        ) : (
          <>
            <Suggestion text={`Hey ${members[0]?.name}, what can you do?`} />
            <Suggestion text="Help me with something" />
          </>
        )}
      </div>
    </div>
  );
}

function Suggestion({ text }: { text: string }) {
  return (
    <div className="rounded-full border border-border/60 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground">
      {text}
    </div>
  );
}
