"use client";

import { useState } from "react";
import type { Agent } from "@/db/schema";
import { cn } from "@/lib/utils";

export function SettingsView({ agents }: { agents: Agent[] }) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [personaDraft, setPersonaDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const agent = agents.find((a) => a.id === selectedAgent);

  function selectAgent(a: Agent) {
    setSelectedAgent(a.id);
    setPersonaDraft(a.persona);
    setSavedMsg("");
  }

  async function savePersona() {
    if (!agent) return;
    setSaving(true);
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: personaDraft }),
      });
      setSavedMsg("Saved!");
      setTimeout(() => setSavedMsg(""), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Agent list */}
      <div className="w-64 border-r border-border overflow-y-auto p-2">
        <p className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
          Agents
        </p>
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => selectAgent(a)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm",
              selectedAgent === a.id ? "bg-accent font-medium" : "hover:bg-accent/50",
            )}
          >
            <span className="text-base">{a.avatar}</span>
            <div className="flex-1 text-left">
              <div>{a.name}</div>
              <div className="text-xs text-muted-foreground">{a.role}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Agent detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!agent ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select an agent to edit their persona.
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{agent.avatar}</span>
              <div>
                <h2 className="text-lg font-bold">{agent.name}</h2>
                <p className="text-sm text-muted-foreground">{agent.role}</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Persona (system prompt)</label>
              <textarea
                value={personaDraft}
                onChange={(e) => setPersonaDraft(e.target.value)}
                rows={20}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none ring-ring focus:ring-2"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={savePersona}
                disabled={saving}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Persona"}
              </button>
              {savedMsg && (
                <span className="text-sm text-green-500">{savedMsg}</span>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Tools</label>
              <div className="flex flex-wrap gap-1">
                {(agent.tools as string[]).map((tool) => (
                  <span
                    key={tool}
                    className="rounded bg-secondary px-2 py-0.5 font-mono text-xs"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
