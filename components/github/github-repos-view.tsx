"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Lock, Unlock, GitBranch, Star, RefreshCw, FolderOpen, Folder } from "lucide-react";

interface Repo {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  html_url: string;
  updated_at: string;
  opened: boolean;
  openedAt: string | null;
}

export function GithubReposView() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  async function loadRepos() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/github/repos");
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to load repos");
      }
      const data = await res.json();
      setRepos(data.repos || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load repos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRepos();
  }, []);

  async function toggleRepo(repo: Repo) {
    setToggling(repo.id);
    try {
      const res = await fetch("/api/github/repos/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: repo.id,
          repoName: repo.name,
          owner: repo.owner,
          opened: !repo.opened,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to toggle");
      }
      // Persist to localStorage as fallback (in case Supabase table doesn't exist)
      try {
        const key = "github-opened-repos";
        const stored = JSON.parse(localStorage.getItem(key) ?? "[]") as number[];
        if (!repo.opened) {
          if (!stored.includes(repo.id)) stored.push(repo.id);
        } else {
          const idx = stored.indexOf(repo.id);
          if (idx >= 0) stored.splice(idx, 1);
        }
        localStorage.setItem(key, JSON.stringify(stored));
      } catch { /* ignore localStorage errors */ }
      setRepos((prev) =>
        prev.map((r) =>
          r.id === repo.id
            ? { ...r, opened: !r.opened, openedAt: !r.opened ? new Date().toISOString() : null }
            : r
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle repo");
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Loading your GitHub repos...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
        <button
          onClick={loadRepos}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const openedRepos = repos.filter((r) => r.opened);
  const closedRepos = repos.filter((r) => !r.opened);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">GitHub Repositories</h2>
          <p className="text-sm text-muted-foreground">
            Open a repo to let agents read, edit, and push code. Closed repos are invisible to agents.
          </p>
        </div>
        <button
          onClick={loadRepos}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {openedRepos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-green-600 dark:text-green-500">
            Open for agents ({openedRepos.length})
          </p>
          {openedRepos.map((repo) => (
            <RepoCard key={repo.id} repo={repo} onToggle={toggleRepo} toggling={toggling === repo.id} />
          ))}
        </div>
      )}

      {closedRepos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            All repositories ({closedRepos.length})
          </p>
          {closedRepos.map((repo) => (
            <RepoCard key={repo.id} repo={repo} onToggle={toggleRepo} toggling={toggling === repo.id} />
          ))}
        </div>
      )}

      {repos.length === 0 && (
        <div className="rounded-lg border border-border/50 p-8 text-center text-sm text-muted-foreground">
          No repositories found. Make sure your GitHub token has access to repos.
        </div>
      )}
    </div>
  );
}

function RepoCard({
  repo,
  onToggle,
  toggling,
}: {
  repo: Repo;
  onToggle: (repo: Repo) => void;
  toggling: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border p-3 transition-colors",
        repo.opened
          ? "border-green-500/30 bg-green-500/5"
          : "border-border/50"
      )}
    >
      <div className="flex items-center gap-3 overflow-hidden">
        {repo.opened ? (
          <FolderOpen className="h-5 w-5 shrink-0 text-green-600 dark:text-green-500" />
        ) : (
          <Folder className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="font-medium">{repo.name}</span>
            {repo.private && (
              <Lock className="h-3 w-3 text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{repo.owner}</span>
            <span>·</span>
            <GitBranch className="h-3 w-3" />
            <span>{repo.default_branch}</span>
            <span>·</span>
            <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
          </div>
          {repo.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{repo.description}</p>
          )}
        </div>
      </div>
      <button
        onClick={() => onToggle(repo)}
        disabled={toggling}
        className={cn(
          "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50",
          repo.opened
            ? "bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400"
            : "bg-green-600 text-white hover:bg-green-700"
        )}
      >
        {toggling ? "..." : repo.opened ? "Close Git" : "Open Git"}
      </button>
    </div>
  );
}
