"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ClientAgent as Agent } from "@/db/client-types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/avatar";
import { ReposView } from "@/components/repos/repos-view";

type Tab = "integrations" | "repos" | "agents";

export function SettingsView({ agents }: { agents: Agent[] }) {
  const [tab, setTab] = useState<Tab>("integrations");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [personaDraft, setPersonaDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [checkingGoogle, setCheckingGoogle] = useState(true);

  const agent = agents.find((a) => a.id === selectedAgent);

  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((d) => setGoogleConnected(d.connected))
      .catch(() => setGoogleConnected(false))
      .finally(() => setCheckingGoogle(false));
  }, []);

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
      {/* Sidebar with tabs */}
      <div className="w-64 border-r border-border/50 overflow-y-auto p-2">
        {/* Back button */}
        <Link
          href="/chat/all-team"
          className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Chat
        </Link>
        {/* Tabs */}
        <div className="mb-3 flex gap-1 rounded-lg bg-muted/50 p-1">
          {([
            { id: "integrations" as Tab, label: "Apps" },
            { id: "repos" as Tab, label: "Repos" },
            { id: "agents" as Tab, label: "Agents" },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "integrations" && (
          <div className="space-y-2">
            <p className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
              Integrations
            </p>
            <div className="rounded-lg border border-border/50 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📧</span>
                  <div>
                    <p className="text-sm font-medium">Google</p>
                    <p className="text-xs text-muted-foreground">Calendar & Gmail</p>
                  </div>
                </div>
                {checkingGoogle ? (
                  <span className="text-xs text-muted-foreground">...</span>
                ) : googleConnected ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-500">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    Connected
                  </span>
                ) : (
                  <a
                    href="/api/google/connect"
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Connect
                  </a>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-border/50 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">☁️</span>
                  <div>
                    <p className="text-sm font-medium">Cloudflare R2</p>
                    <p className="text-xs text-muted-foreground">Repo storage</p>
                  </div>
                </div>
                <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-500">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Connected
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === "repos" && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Upload and manage your code repositories. Agents can read these to help with your projects.
          </p>
        )}

        {tab === "agents" && (
          <>
            <p className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
              Agents
            </p>
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => selectAgent(a)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  selectedAgent === a.id ? "bg-accent font-medium" : "hover:bg-accent/50",
                )}
              >
                <Avatar id={a.id} emoji={a.avatar} name={a.name} size="sm" />
                <div className="flex-1 text-left">
                  <div>{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.role}</div>
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "integrations" && (
          <div className="mx-auto max-w-2xl space-y-4">
            <h2 className="text-lg font-bold">Integrations</h2>
            <p className="text-sm text-muted-foreground">
              Connect external services so your AI team can access them.
            </p>
            <div className="rounded-xl border border-border/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📧</span>
                  <div>
                    <p className="font-medium">Google Calendar & Gmail</p>
                    <p className="text-xs text-muted-foreground">Let Eve manage your calendar and send emails</p>
                  </div>
                </div>
                {checkingGoogle ? (
                  <span className="text-xs text-muted-foreground">Checking...</span>
                ) : googleConnected ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-500">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    Connected
                  </span>
                ) : (
                  <a
                    href="/api/google/connect"
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Connect
                  </a>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-border/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">☁️</span>
                  <div>
                    <p className="font-medium">Cloudflare R2</p>
                    <p className="text-xs text-muted-foreground">Store your code repos for agents to read</p>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-500">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Connected
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === "repos" && <ReposView />}

        {tab === "agents" && (
          <>
            {!agent ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <p className="text-sm">Select an agent to edit their persona.</p>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar id={agent.id} emoji={agent.avatar} name={agent.name} size="lg" />
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
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={savePersona}
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Persona"}
                  </button>
                  {savedMsg && (
                    <span className="text-sm text-green-600 dark:text-green-500">{savedMsg}</span>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Tools</label>
                  <div className="flex flex-wrap gap-1">
                    {(agent.tools as string[]).map((tool) => (
                      <span
                        key={tool}
                        className="rounded-md bg-secondary px-2 py-1 font-mono text-xs"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
