"use client";

import { useState, useEffect } from "react";
import { DollarSign, Zap, Cpu, TrendingUp, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

type UsageData = {
  total: { cost: number; requests: number; inputTokens: number; outputTokens: number; toolCalls: number };
  today: { cost: number; requests: number };
  byModel: Record<string, { requests: number; cost: number; inputTokens: number; outputTokens: number }>;
  byAgent: Record<string, { requests: number; cost: number; toolCalls: number }>;
  byDay: Record<string, { requests: number; cost: number }>;
  recent: { id: string; model: string; agent_id: string | null; input_tokens: number; output_tokens: number; cost_usd: number; tool_calls: number; created_at: string }[];
};

// Rate limits from Google AI Studio (paid tier)
const RATE_LIMITS: Record<string, { rpm: number; tpm: number; rpd: number }> = {
  "gemini-2.5-flash": { rpm: 1000, tpm: 1_000_000, rpd: 10_000 },
  "gemini-2.5-flash-lite": { rpm: 4000, tpm: 4_000_000, rpd: 100_000 },
  "gemini-3.1-flash-lite": { rpm: 4000, tpm: 4_000_000, rpd: 150_000 },
  "gemini-2.0-flash": { rpm: 2000, tpm: 4_000_000, rpd: 999_999 },
  "gemini-2.0-flash-lite": { rpm: 4000, tpm: 4_000_000, rpd: 999_999 },
};

const AGENT_NAMES: Record<string, string> = {
  zack: "Zack", kevin: "Kevin", beepbop: "Beepbop",
  maya: "Maya", leo: "Leo", sally: "Sally", evie: "Evie", lex: "Lex",
};

export function UsageView() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading usage...</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h2 className="text-lg font-bold">API Usage</h2>
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-500">
            Usage tracking not set up yet. Run this SQL in your Supabase dashboard:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs font-mono text-white/70">
{`CREATE TABLE IF NOT EXISTS api_usage (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'cheap',
  agent_id TEXT,
  chat_id TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_usd DECIMAL(10,6) DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage (created_at DESC);`}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Go to <a href="https://supabase.com/dashboard" target="_blank" className="text-blue-500 underline">Supabase Dashboard</a> → SQL Editor → paste and run.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const cost = data.total.cost;
  const todayCost = data.today.cost;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-bold">API Usage</h2>
        <p className="text-sm text-muted-foreground">Gemini API spending and rate limit tracking (last 28 days)</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Total Cost"
          value={`$${cost.toFixed(4)}`}
          sub={`$${todayCost.toFixed(4)} today`}
          accent="green"
        />
        <StatCard
          icon={<Zap className="h-4 w-4" />}
          label="Requests"
          value={data.total.requests.toLocaleString()}
          sub={`${data.today.requests} today`}
          accent="blue"
        />
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          label="Tokens"
          value={`${((data.total.inputTokens + data.total.outputTokens) / 1000).toFixed(1)}K`}
          sub={`${data.total.inputTokens.toLocaleString()} in / ${data.total.outputTokens.toLocaleString()} out`}
          accent="purple"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Tool Calls"
          value={data.total.toolCalls.toLocaleString()}
          sub="GitHub + others"
          accent="orange"
        />
      </div>

      {/* 7-day chart */}
      <div className="rounded-xl border border-border/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Last 7 Days</h3>
        </div>
        <div className="flex items-end gap-2 h-32">
          {Object.entries(data.byDay).map(([day, stats]) => {
            const maxReq = Math.max(...Object.values(data.byDay).map(d => d.requests), 1);
            const height = (stats.requests / maxReq) * 100;
            return (
              <div key={day} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-blue-500/40 to-blue-500/80 transition-all hover:from-blue-500/60 hover:to-blue-500"
                    style={{ height: `${Math.max(height, 2)}%` }}
                    title={`${stats.requests} requests, $${stats.cost.toFixed(4)}`}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(day).toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground/60">{stats.requests}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* By model */}
      <div className="rounded-xl border border-border/50 p-4">
        <h3 className="mb-3 text-sm font-semibold">By Model</h3>
        <div className="space-y-3">
          {Object.entries(data.byModel)
            .sort(([, a], [, b]) => b.cost - a.cost)
            .map(([model, stats]) => {
              const limits = RATE_LIMITS[model];
              const rpdPct = limits ? Math.min((stats.requests / limits.rpd) * 100, 100) : 0;
              return (
                <div key={model}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-mono font-medium">{model}</span>
                    <span className="text-muted-foreground">
                      {stats.requests} req · ${stats.cost.toFixed(4)} · {(stats.inputTokens / 1000).toFixed(1)}K in · {(stats.outputTokens / 1000).toFixed(1)}K out
                    </span>
                  </div>
                  {limits && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            rpdPct > 80 ? "bg-red-500" : rpdPct > 50 ? "bg-yellow-500" : "bg-green-500",
                          )}
                          style={{ width: `${rpdPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                        {stats.requests}/{limits.rpd.toLocaleString()} RPD
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* By agent */}
      <div className="rounded-xl border border-border/50 p-4">
        <h3 className="mb-3 text-sm font-semibold">By Agent</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(data.byAgent)
            .sort(([, a], [, b]) => b.requests - a.requests)
            .map(([agentId, stats]) => (
              <div key={agentId} className="rounded-lg bg-muted/30 p-2.5">
                <div className="text-sm font-medium">{AGENT_NAMES[agentId] ?? agentId}</div>
                <div className="text-xs text-muted-foreground">{stats.requests} requests</div>
                <div className="text-xs text-muted-foreground">{stats.toolCalls} tool calls</div>
                <div className="text-xs font-mono text-green-600 dark:text-green-500">${stats.cost.toFixed(4)}</div>
              </div>
            ))}
        </div>
      </div>

      {/* Recent calls */}
      <div className="rounded-xl border border-border/50 p-4">
        <h3 className="mb-3 text-sm font-semibold">Recent Calls</h3>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {data.recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">No calls logged yet.</p>
          ) : (
            data.recent.map(r => (
              <div key={r.id} className="flex items-center justify-between rounded-lg bg-muted/20 px-2.5 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">{r.model.replace("gemini-", "")}</span>
                  <span className="text-muted-foreground/60">·</span>
                  <span>{AGENT_NAMES[r.agent_id ?? ""] ?? r.agent_id ?? "—"}</span>
                  {r.tool_calls > 0 && <span className="rounded bg-orange-500/10 px-1 text-[10px] text-orange-500">{r.tool_calls} tools</span>}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{r.input_tokens + r.output_tokens} tok</span>
                  <span className="font-mono text-green-600 dark:text-green-500">${Number(r.cost_usd).toFixed(5)}</span>
                  <span className="text-muted-foreground/60">{new Date(r.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: "green" | "blue" | "purple" | "orange";
}) {
  const accents = {
    green: "text-green-500 bg-green-500/10",
    blue: "text-blue-500 bg-blue-500/10",
    purple: "text-purple-500 bg-purple-500/10",
    orange: "text-orange-500 bg-orange-500/10",
  };
  return (
    <div className="rounded-xl border border-border/50 p-3">
      <div className={cn("mb-2 flex h-7 w-7 items-center justify-center rounded-lg", accents[accent])}>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-[10px] text-muted-foreground/60">{sub}</div>
    </div>
  );
}
