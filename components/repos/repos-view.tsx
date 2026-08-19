"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Upload, Folder, File, ChevronRight, ChevronDown, RefreshCw, Send, Code2, MessageSquare, X, Loader2, Trash2, GitBranch, RotateCcw, Check } from "lucide-react";
import { useUpload } from "@/components/upload-provider";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/avatar";

type RepoFile = {
  path: string;
  size: number;
  lastModified?: string;
};

type FileTreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
  size?: number;
};

type ChatMessage = {
  role: "user" | "agent";
  content: string;
  fileReads?: { path: string; content: string }[];
};

const CODE_AGENTS = [
  { id: "zack", name: "Zack", role: "Senior Engineer" },
  { id: "kevin", name: "Kevin", role: "Software Architect" },
  { id: "beepbop", name: "Beepbop", role: "Creative Coder" },
  { id: "sally", name: "Sally", role: "Website & SEO Builder" },
  { id: "evie", name: "Evie", role: "Executive Assistant" },
];

export function ReposView() {
  const { upload, startUpload } = useUpload();
  const [repos, setRepos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [error, setError] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Changes tab
  const [view, setView] = useState<"repos" | "changes">("repos");
  const [pendingChanges, setPendingChanges] = useState<{ id: string; repo: string; path: string; timestamp: number }[]>([]);
  const [snapshots, setSnapshots] = useState<{ id: string; timestamp: number; fileCount: number }[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // File viewer
  const [selectedFile, setSelectedFile] = useState<RepoFile | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAgent, setChatAgent] = useState("zack");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/r2/repos");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setRepos(data.repos ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load repos");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFiles = useCallback(async (repo: string) => {
    try {
      const res = await fetch(`/api/r2/repos?repo=${encodeURIComponent(repo)}`);
      const data = await res.json();
      if (data.files) {
        setFiles(data.files);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  useEffect(() => {
    if (selectedRepo) {
      fetchFiles(selectedRepo);
    } else {
      setFiles([]);
      setSelectedFile(null);
    }
  }, [selectedRepo, fetchFiles]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;
    // Don't clear the input until after upload — clearing can invalidate FileList in some browsers
    await startUpload(fileList);
    event.target.value = "";
    // Refresh repo list after upload
    await fetchRepos();
  }

  async function openFile(file: RepoFile) {
    if (!selectedRepo) return;
    setSelectedFile(file);
    setLoadingFile(true);
    setFileContent("");
    try {
      const res = await fetch(`/api/r2/file?repo=${encodeURIComponent(selectedRepo)}&path=${encodeURIComponent(file.path)}`);
      const data = await res.json();
      if (data.content) {
        setFileContent(data.content);
      } else if (data.error) {
        setFileContent(`Error: ${data.error}`);
      }
    } catch (err) {
      setFileContent(`Error: ${err instanceof Error ? err.message : "Failed to load"}`);
    } finally {
      setLoadingFile(false);
    }
  }

  function toggleDir(path: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function deleteRepo(repo: string) {
    if (!confirm(`Delete the entire "${repo}" repo? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/r2/repos/${encodeURIComponent(repo)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Failed to delete (${res.status})`);
        return;
      }
      if (selectedRepo === repo) {
        setSelectedRepo(null);
        setSelectedFile(null);
      }
      await fetchRepos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete repo");
    }
  }

  async function fetchChanges() {
    setLoadingChanges(true);
    try {
      const res = await fetch("/api/r2/changes");
      const data = await res.json();
      if (data.changes) setPendingChanges(data.changes);
      if (data.snapshots) setSnapshots(data.snapshots);
    } catch {
      // ignore
    } finally {
      setLoadingChanges(false);
    }
  }

  async function acceptChange(change: { repo: string; path: string; timestamp: number }) {
    const key = `${change.repo}/${change.path}/${change.timestamp}`;
    setActionLoading(key);
    try {
      await fetch("/api/r2/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", repo: change.repo, path: change.path, timestamp: change.timestamp }),
      });
      await fetchChanges();
    } finally {
      setActionLoading(null);
    }
  }

  async function rejectChange(change: { repo: string; path: string; timestamp: number }) {
    const key = `${change.repo}/${change.path}/${change.timestamp}`;
    setActionLoading(key);
    try {
      await fetch("/api/r2/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", repo: change.repo, path: change.path, timestamp: change.timestamp }),
      });
      await fetchChanges();
    } finally {
      setActionLoading(null);
    }
  }

  async function rollbackSnapshot(repo: string, snapshotId: string) {
    if (!confirm(`Rollback ${repo} to snapshot ${new Date(parseInt(snapshotId, 10)).toLocaleString()}? This will replace ALL current files.`)) return;
    const key = `${repo}/${snapshotId}`;
    setActionLoading(key);
    try {
      await fetch("/api/r2/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rollback_snapshot", repo, snapshotId }),
      });
      await fetchChanges();
    } finally {
      setActionLoading(null);
    }
  }

  useEffect(() => {
    if (view === "changes") fetchChanges();
  }, [view]);

  async function sendChat() {
    if (!chatInput.trim() || chatStreaming) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatStreaming(true);

    const fileCtx = selectedFile
      ? { path: selectedFile.path, content: fileContent }
      : null;

    const abort = new AbortController();
    chatAbortRef.current = abort;

    try {
      const res = await fetch("/api/r2/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: chatAgent,
          message: userMsg,
          fileContext: fileCtx,
          repoName: selectedRepo ?? undefined,
          history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: abort.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";
      let agentText = "";
      const fileReads: { path: string; content: string }[] = [];

      setChatMessages((prev) => [...prev, { role: "agent", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === "token") {
            agentText += data.text;
            setChatMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "agent", content: agentText, fileReads: fileReads.length > 0 ? fileReads : undefined };
              return next;
            });
          } else if (data.type === "file_read") {
            fileReads.push({ path: data.path, content: data.content });
            setChatMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], fileReads: [...fileReads] };
              return next;
            });
          } else if (data.type === "error") {
            setChatMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "agent", content: `Error: ${data.message}` };
              return next;
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setChatMessages((prev) => [...prev, { role: "agent", content: `Error: ${err instanceof Error ? err.message : "Failed"}` }]);
      }
    } finally {
      setChatStreaming(false);
      chatAbortRef.current = null;
    }
  }

  const fileTree = buildFileTree(files);
  const uploading = upload?.active ?? false;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Repositories</h2>
          <p className="text-sm text-muted-foreground">Upload code repos so your AI team can read them</p>
        </div>
        <button
          onClick={fetchRepos}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit">
        <button
          onClick={() => setView("repos")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
            view === "repos" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Repositories
        </button>
        <button
          onClick={() => setView("changes")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
            view === "changes" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Recent Changes
        </button>
      </div>

      {view === "changes" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Recent file changes & deploy snapshots</p>
            <button
              onClick={fetchChanges}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {loadingChanges ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              {/* Pending file changes (accept/reject) */}
              <div>
                <h3 className="mb-2 text-sm font-semibold">Pending File Changes</h3>
                {pendingChanges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pending changes. When agents edit files, they'll appear here for you to accept or reject.</p>
                ) : (
                  <div className="space-y-1">
                    {pendingChanges.map((change, i) => {
                      const key = `${change.repo}/${change.path}/${change.timestamp}`;
                      return (
                        <div key={i} className="flex items-center gap-3 rounded-xl border border-border/50 px-4 py-3">
                          <File className="h-4 w-4 shrink-0 text-blue-500" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono truncate">{change.repo}/{change.path}</p>
                            <p className="text-xs text-muted-foreground">{new Date(change.timestamp).toLocaleString()}</p>
                          </div>
                          <button
                            onClick={() => rejectChange(change)}
                            disabled={actionLoading === key}
                            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                          >
                            {actionLoading === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            Reject (Undo)
                          </button>
                          <button
                            onClick={() => acceptChange(change)}
                            disabled={actionLoading === key}
                            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-green-600 hover:bg-green-500/10 dark:text-green-500"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Accept
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Deploy snapshots (rollback) */}
              <div>
                <h3 className="mb-2 text-sm font-semibold">Deploy Snapshots (7-day retention)</h3>
                {snapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No snapshots yet. Snapshots are created automatically when the coding team deploys to Netlify.</p>
                ) : (
                  <div className="space-y-1">
                    {snapshots.map((snap, i) => {
                      const key = `${selectedRepo}/${snap.id}`;
                      return (
                        <div key={i} className="flex items-center gap-3 rounded-xl border border-border/50 px-4 py-3">
                          <GitBranch className="h-4 w-4 shrink-0 text-purple-500" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">Snapshot {new Date(snap.timestamp).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">{snap.fileCount} files</p>
                          </div>
                          <button
                            onClick={() => rollbackSnapshot(selectedRepo ?? "", snap.id)}
                            disabled={actionLoading === key}
                            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-orange-600 hover:bg-orange-500/10 dark:text-orange-400"
                          >
                            {actionLoading === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            Rollback
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
      {/* Upload button */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-blue-500/40 bg-blue-500/5 px-4 py-4 text-sm font-medium text-blue-600 transition-all hover:bg-blue-500/10 dark:text-blue-400"
      >
        <Upload className="h-4 w-4" />
        Upload Repo Folder
        <input
          ref={fileInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is a valid HTML attribute
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleUpload}
          style={{ display: "none" }}
          disabled={uploading}
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-500">
          {error}
        </div>
      )}

      {/* Main content: file tree + file viewer + chat */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : repos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No repos yet. Upload one above.</p>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          {/* File tree */}
          <div className="col-span-3 space-y-1">
            {repos.map((repo) => (
              <div key={repo} className="rounded-xl border border-border/50 overflow-hidden">
                <div className="flex items-center">
                  <button
                    onClick={() => setSelectedRepo(selectedRepo === repo ? null : repo)}
                    className="flex flex-1 items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent/50"
                  >
                    {selectedRepo === repo ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Folder className="h-4 w-4 text-blue-500" />
                    <span className="truncate">{repo}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteRepo(repo); }}
                    className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                    title="Delete repo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {selectedRepo === repo && (
                  <div className="border-t border-border/50 max-h-[60vh] overflow-y-auto">
                    <FileTree
                      node={fileTree}
                      expandedDirs={expandedDirs}
                      onToggleDir={toggleDir}
                      onFileClick={openFile}
                      selectedPath={selectedFile?.path}
                      depth={0}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* File viewer */}
          <div className="col-span-6 rounded-xl border border-border/50 overflow-hidden flex flex-col" style={{ height: "70vh" }}>
            {selectedFile ? (
              <>
                <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 bg-muted/30">
                  <File className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">{selectedFile.path}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatSize(selectedFile.size)}</span>
                </div>
                <div className="flex-1 overflow-auto">
                  {loadingFile ? (
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <pre className="selectable p-3 text-xs font-mono whitespace-pre-wrap break-words">
                      {fileContent}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Code2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  <p className="text-sm">Select a file to view its contents</p>
                </div>
              </div>
            )}
          </div>

          {/* Chat panel */}
          <div className="col-span-3 flex flex-col" style={{ height: "70vh" }}>
            {!chatOpen ? (
              <button
                onClick={() => setChatOpen(true)}
                className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 text-muted-foreground transition-all hover:border-blue-500/40 hover:bg-blue-500/5"
              >
                <MessageSquare className="h-6 w-6" />
                <span className="text-sm font-medium">Chat with agent</span>
                <span className="text-xs">Ask about your code</span>
              </button>
            ) : (
              <div className="flex h-full flex-col rounded-xl border border-border/50 overflow-hidden">
                {/* Chat header */}
                <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 bg-muted/30">
                  <select
                    value={chatAgent}
                    onChange={(e) => {
                      setChatAgent(e.target.value);
                      setChatMessages([]);
                    }}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium outline-none"
                  >
                    {CODE_AGENTS.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} — {a.role}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { setChatOpen(false); setChatMessages([]); }}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Context indicator */}
                {selectedFile && (
                  <div className="border-b border-border/50 px-3 py-1.5 bg-blue-500/5">
                    <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
                      Context: {selectedFile.path}
                    </p>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {chatMessages.length === 0 && (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                      Ask {CODE_AGENTS.find(a => a.id === chatAgent)?.name} about your code.
                      {selectedFile
                        ? " They can see the file you have open."
                        : " Select a file to give them context."}
                    </p>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={cn("flex gap-2", msg.role === "user" && "flex-row-reverse")}>
                      {msg.role === "user" ? (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white">A</div>
                      ) : (
                        <Avatar id={chatAgent} name={CODE_AGENTS.find(a => a.id === chatAgent)?.name} size="xs" />
                      )}
                      <div className={cn(
                        "rounded-lg px-2.5 py-1.5 text-xs max-w-[85%]",
                        msg.role === "user" ? "bg-blue-600 text-white" : "bg-muted",
                      )}>
                        <p className="selectable whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={chatBottomRef} />
                </div>

                {/* Input */}
                <div className="border-t border-border/50 p-2">
                  <div className="flex items-end gap-1">
                    <textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendChat();
                        }
                      }}
                      placeholder="Ask about this file..."
                      rows={2}
                      className="flex-1 resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={sendChat}
                      disabled={chatStreaming || !chatInput.trim()}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white disabled:opacity-30"
                    >
                      {chatStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function buildFileTree(files: RepoFile[]): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      if (!current.children) current.children = [];

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path,
          isDir: !isLast,
          children: isLast ? undefined : [],
          size: isLast ? file.size : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  function sortTree(node: FileTreeNode) {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  }
  sortTree(root);

  return root;
}

function FileTree({
  node,
  expandedDirs,
  onToggleDir,
  onFileClick,
  selectedPath,
  depth,
}: {
  node: FileTreeNode;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFileClick: (file: RepoFile) => void;
  selectedPath?: string;
  depth: number;
}) {
  if (!node.children) return null;

  return (
    <>
      {node.children.map((child) => (
        <div key={child.path}>
          <button
            onClick={() => {
              if (child.isDir) {
                onToggleDir(child.path);
              } else {
                onFileClick({ path: child.path, size: child.size ?? 0 });
              }
            }}
            className={cn(
              "flex w-full items-center gap-1.5 border-b border-border/30 px-2 py-1.5 text-xs transition-colors hover:bg-accent/50",
              !child.isDir && selectedPath === child.path && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {child.isDir ? (
              <>
                {expandedDirs.has(child.path) ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <Folder className="h-3 w-3 shrink-0 text-blue-500/70" />
                <span className="font-medium truncate">{child.name}</span>
              </>
            ) : (
              <>
                <span className="w-3" />
                <File className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">{child.name}</span>
              </>
            )}
          </button>
          {child.isDir && expandedDirs.has(child.path) && child.children && (
            <FileTree
              node={child}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onFileClick={onFileClick}
              selectedPath={selectedPath}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
