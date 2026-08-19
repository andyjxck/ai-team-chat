import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const GITHUB_API = "https://api.github.com";

// Simple AES-256-CBC encryption for storing tokens in DB
const ENC_KEY = process.env.AUTH_SECRET ?? "fallback-key-not-secure";
const KEY = Buffer.from(ENC_KEY.padEnd(32, "0").slice(0, 32), "utf-8");
const IV_LENGTH = 16;

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-cbc", KEY, iv);
  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(encrypted: string): string {
  const [ivHex, data] = encrypted.split(":");
  if (!ivHex || !data) return "";
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", KEY, iv);
  let decrypted = decipher.update(data, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}

// Use the env token as fallback (for server-side agent operations)
export function getGithubToken(): string {
  return process.env.GITHUB_TOKEN ?? "";
}

async function ghFetch(path: string, options: RequestInit = {}, token?: string) {
  const authToken = token ?? getGithubToken();
  if (!authToken) throw new Error("GITHUB_TOKEN not configured");
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${authToken}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  html_url: string;
  updated_at: string;
}

export async function listRepos(token?: string): Promise<GithubRepo[]> {
  const res = await ghFetch("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator", {}, token);
  const repos = await res.json() as any[];
  return repos.map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    owner: r.owner.login,
    private: r.private,
    default_branch: r.default_branch,
    description: r.description,
    html_url: r.html_url,
    updated_at: r.updated_at,
  }));
}

export async function listRepoFiles(owner: string, repo: string, path = "", token?: string): Promise<{ name: string; path: string; type: string }[]> {
  const res = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {}, token);
  const items = await res.json() as any[];
  if (!Array.isArray(items)) return [];
  return items.map((i) => ({ name: i.name, path: i.path, type: i.type }));
}

export async function readFile(owner: string, repo: string, path: string, token?: string): Promise<string> {
  const res = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {}, token);
  const data = await res.json() as any;
  if (data.type === "file" && data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  return data.content ?? "";
}

export async function createOrUpdateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
  token?: string
): Promise<{ sha: string; commit: { sha: string; html_url: string } }> {
  // Get current file SHA (if exists)
  let sha: string | undefined;
  try {
    const res = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {}, token);
    const data = await res.json() as any;
    sha = data.sha;
  } catch { /* file doesn't exist yet */ }

  const body: any = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  const res = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, token);
  return res.json();
}

export async function deleteFile(
  owner: string,
  repo: string,
  path: string,
  message: string,
  token?: string
): Promise<void> {
  let sha: string | undefined;
  try {
    const res = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {}, token);
    const data = await res.json() as any;
    sha = data.sha;
  } catch { /* already gone */ }
  if (!sha) return;

  await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha }),
  }, token);
}

export async function getCommits(owner: string, repo: string, perPage = 10, token?: string) {
  const res = await ghFetch(`/repos/${owner}/${repo}/commits?per_page=${perPage}`, {}, token);
  return res.json();
}

export async function getCommit(owner: string, repo: string, sha: string, token?: string) {
  const res = await ghFetch(`/repos/${owner}/${repo}/commits/${sha}`, {}, token);
  return res.json();
}

export async function createBranch(owner: string, repo: string, branchName: string, fromBranch = "main", token?: string) {
  // Get the SHA of the source branch
  const refRes = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${fromBranch}`, {}, token);
  const refData = await refRes.json() as any;
  const sha = refData.object.sha;

  // Create the new branch ref
  const res = await ghFetch(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  }, token);
  return res.json();
}

export async function createPullRequest(
  owner: string, repo: string,
  title: string, head: string, base: string,
  body?: string, token?: string,
): Promise<{ number: number; html_url: string; state: string }> {
  const res = await ghFetch(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body: body ?? "" }),
  }, token);
  return res.json();
}

export async function createIssue(
  owner: string, repo: string,
  title: string, body?: string, labels?: string[], token?: string,
): Promise<{ number: number; html_url: string; state: string }> {
  const res = await ghFetch(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body: body ?? "", labels: labels ?? [] }),
  }, token);
  return res.json();
}

export async function searchCode(query: string, owner?: string, repo?: string, token?: string) {
  const q = owner && repo ? `${query} repo:${owner}/${repo}` : query;
  const res = await ghFetch(`/search/code?q=${encodeURIComponent(q)}&per_page=20`, {}, token);
  return res.json();
}

export async function listBranches(owner: string, repo: string, token?: string) {
  const res = await ghFetch(`/repos/${owner}/${repo}/branches?per_page=100`, {}, token);
  return res.json();
}

export async function getUser(token?: string) {
  const res = await ghFetch("/user", {}, token);
  return res.json();
}
