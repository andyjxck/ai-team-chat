"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, Settings, Users, X, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

type SidebarChat = {
  id: string;
  name: string;
  type: string;
  routingMode: string;
  isDefault: boolean;
  members: { id: string; name: string; avatar: string | null; role: string }[];
};

export function ChatSidebar({
  chats,
  onClose,
}: {
  chats: SidebarChat[];
  onClose?: () => void;
}) {
  const pathname = usePathname();

  const dmChats = chats.filter((c) => c.type === "dm");
  const groupChats = chats.filter((c) => c.type === "group");

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-secondary/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-sm font-bold">AI Team Chat</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
          {/* Close button — mobile only */}
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* New chat button */}
      <div className="px-3 py-2">
        <Link
          href="/chat/new"
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/chat/new"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent",
          )}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </Link>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Group chats */}
        {groupChats.length > 0 && (
          <div className="mb-3">
            <p className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
              Group Chats
            </p>
            {groupChats.map((chat) => (
              <ChatLink
                key={chat.id}
                chat={chat}
                active={pathname === `/chat/${chat.id}`}
              />
            ))}
          </div>
        )}

        {/* DMs */}
        <div>
          <p className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
            Direct Messages
          </p>
          {dmChats.map((chat) => (
            <ChatLink
              key={chat.id}
              chat={chat}
              active={pathname === `/chat/${chat.id}`}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-2">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/settings"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent",
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}

function ChatLink({
  chat,
  active,
}: {
  chat: SidebarChat;
  active: boolean;
}) {
  const avatars = chat.members.map((m) => m.avatar).filter(Boolean);
  const isGroup = chat.type === "group";

  return (
    <Link
      href={`/chat/${chat.id}`}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors",
        active ? "bg-accent font-medium" : "hover:bg-accent/50",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-base">
        {isGroup ? (
          <Users className="h-4 w-4 text-muted-foreground" />
        ) : (
          avatars[0] ?? "💬"
        )}
      </span>
      <span className="truncate">{chat.name}</span>
    </Link>
  );
}
