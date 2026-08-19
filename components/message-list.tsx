"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "./message-bubble";
import { DraftCard } from "./draft-card";
import { QuestionCard } from "./question-card";
import { CodePreviewCard } from "./code-preview-card";
import { ChangeReviewCard, type FileChange } from "./change-review-card";
import { LiveCodeEditor, type LiveCodeEdit } from "./live-code-editor";
import { Avatar } from "./avatar";
import type { ClientMessage, DraftData, QuestionData, CodeChangeData } from "@/db/client-types";

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
      <div className="mx-auto max-w-3xl space-y-4">
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
        {messages.map((msg) => (
          <div key={msg.id} className="space-y-2">
            <MessageBubble message={msg} onReply={onReply} />
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
            {/* Live code editing */}
            {msg.codeChanges && msg.codeChanges.length > 0 && (
              <div className="ml-11 space-y-2">
                {msg.codeChanges.map((change, idx) => {
                  const agent = msg.agent;
                  const edit: LiveCodeEdit = {
                    repo: change.repo,
                    path: change.path,
                    description: change.description,
                    oldContent: change.oldContent ?? "",
                    newContent: change.newContent ?? "",
                    agentName: agent?.name ?? "Agent",
                    agentAvatar: agent?.avatar ?? "🤖",
                    agentId: agent?.id ?? "system",
                    changeId: change.changeId,
                    status: change.status === "applied" ? "done" : change.status as "done" | "accepted" | "rejected",
                  };
                  return <LiveCodeEditor key={`${change.path}-${idx}`} edit={edit} />;
                })}
              </div>
            )}
          </div>
        ))}
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
