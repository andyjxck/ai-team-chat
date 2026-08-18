"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent } from "@/db/schema";
import { cn } from "@/lib/utils";

export function NewChatForm({ agents }: { agents: Agent[] }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [routingMode, setRoutingMode] = useState<"mentioned_only" | "all_members">("mentioned_only");
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  function toggleAgent(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  }

  async function handleCreate() {
    if (!name.trim() || selected.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          agentIds: selected,
          routingMode: selected.length === 1 ? "mentioned_only" : routingMode,
        }),
      });
      const data = await res.json();
      if (data.id) {
        router.push(`/chat/${data.id}`);
        router.refresh();
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Chat name */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Chat name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Marketing Squad"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
        />
      </div>

      {/* Agent selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Team members</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => toggleAgent(agent.id)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                selected.includes(agent.id)
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-accent",
              )}
            >
              <span className="text-lg">{agent.avatar}</span>
              <div className="flex-1">
                <div className="font-medium">{agent.name}</div>
                <div className="text-xs text-muted-foreground">{agent.role}</div>
              </div>
              {selected.includes(agent.id) && (
                <span className="text-primary">✓</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Routing mode (only for groups) */}
      {selected.length > 1 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Response mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => setRoutingMode("mentioned_only")}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm",
                routingMode === "mentioned_only"
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-accent",
              )}
            >
              <div className="font-medium">@Mentioned only</div>
              <div className="text-xs text-muted-foreground">
                Only addressed agents respond
              </div>
            </button>
            <button
              onClick={() => setRoutingMode("all_members")}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm",
                routingMode === "all_members"
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-accent",
              )}
            >
              <div className="font-medium">All members</div>
              <div className="text-xs text-muted-foreground">
                Everyone responds to each message
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Create button */}
      <button
        onClick={handleCreate}
        disabled={!name.trim() || selected.length === 0 || creating}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {creating ? "Creating..." : "Create Chat"}
      </button>
    </div>
  );
}
