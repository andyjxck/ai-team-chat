"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, Settings, LogOut, Search, Code2, Zap } from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar, AvatarGroup } from "./avatar";
import { useState } from "react";
import Image from "next/image";

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type SidebarChat = {
  id: string;
  name: string;
  type: string;
  routingMode: string;
  isDefault: boolean;
  members: { id: string; name: string; avatar: string | null; role: string }[];
  lastMessage: { content: string; createdAt: string; senderName: string } | null;
};

export function ChatSidebar({
  chats,
  onClose,
}: {
  chats: SidebarChat[];
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");

  const dmChats = chats.filter((c) => c.type === "dm").sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  const groupChats = chats.filter((c) => c.type === "group").sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  const filteredDms = dmChats.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredGroups = groupChats.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <aside
      className="flex h-full w-80 flex-col border-r border-white/5"
      style={{ background: "hsl(var(--sidebar))" }}
    >
      {/* Header — premium look with gradient accent */}
      <div className="flex items-center justify-between px-4 py-4">
        <Link href="/chat" className="flex items-center gap-2.5 group">
          <div className="relative">
            <Image
              src="/agents/logo.jpg"
              alt="Logo"
              width={32}
              height={32}
              className="rounded-xl shadow-lg transition-transform group-hover:scale-105"
            />
            <div className="absolute inset-0 rounded-xl ring-1 ring-white/20" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white">AI Team</h1>
            <p className="text-[10px] font-medium uppercase tracking-wider text-white/30">
              {chats.length} chats · all online
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-white/10 hover:text-white"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white md:hidden"
              title="Close"
            >
              <span className="text-lg leading-none">×</span>
            </button>
          )}
        </div>
      </div>

      {/* Search — sleek pill */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full rounded-xl border-0 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/25 outline-none transition-all focus:bg-white/10 focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* New chat button — prominent */}
      <div className="px-3 pb-3">
        <Link
          href="/chat/new"
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold transition-all",
            pathname === "/chat/new"
              ? "bg-primary text-white shadow-lg shadow-primary/20"
              : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
          )}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </Link>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Group chats */}
        {filteredGroups.length > 0 && (
          <div className="mb-3">
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/25">
              Group Chats
            </p>
            {filteredGroups.map((chat) => (
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
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/25">
            Direct Messages
          </p>
          {filteredDms.map((chat) => (
            <ChatLink
              key={chat.id}
              chat={chat}
              active={pathname === `/chat/${chat.id}`}
            />
          ))}
        </div>
      </div>

      {/* Footer — settings with style */}
      <div className="border-t border-white/5 px-3 py-2.5">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
            pathname?.startsWith("/settings")
              ? "bg-white/10 text-white"
              : "text-white/50 hover:bg-white/5 hover:text-white/80",
          )}
        >
          <Settings className="h-4 w-4" />
          Settings & Repos
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
  const isGroup = chat.type === "group";
  const firstMember = chat.members[0];
  const isCodingTeam = chat.id === "coding-team";

  return (
    <Link
      href={`/chat/${chat.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all",
        active
          ? "bg-white/10 text-white shadow-sm"
          : "text-white/55 hover:bg-white/5 hover:text-white/90",
      )}
    >
      <div className="relative">
        {isGroup ? (
          <AvatarGroup members={chat.members} size="sm" max={2} />
        ) : (
          <Avatar
            id={firstMember?.id ?? "default"}
            emoji={firstMember?.avatar}
            name={firstMember?.name ?? chat.name}
            size="sm"
          />
        )}
        {/* Online indicator */}
        <span className={cn(
          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2",
          active ? "border-[hsl(var(--sidebar))] bg-green-400" : "border-[hsl(var(--sidebar))] bg-green-500/70",
        )} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{chat.name}</p>
          {isCodingTeam && (
            <Code2 className="h-3 w-3 shrink-0 text-blue-400" />
          )}
          {chat.lastMessage && (
            <span className="ml-auto shrink-0 text-[10px] text-white/25">
              {formatRelativeTime(chat.lastMessage.createdAt)}
            </span>
          )}
        </div>
        {chat.lastMessage ? (
          <p className="truncate text-xs text-white/35">
            <span className="text-white/25">{chat.lastMessage.senderName}: </span>
            {chat.lastMessage.content}
          </p>
        ) : isGroup ? (
          <p className="truncate text-xs text-white/25">
            {chat.members.map(m => m.name).join(", ")}
          </p>
        ) : (
          <p className="truncate text-xs text-white/25">{firstMember?.role}</p>
        )}
      </div>
      {active && (
        <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-glow" />
      )}
    </Link>
  );
}
