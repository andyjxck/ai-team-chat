import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listRepos, getGithubToken } from "@/lib/github/client";
import { supabase } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = getGithubToken();
    if (!token) return NextResponse.json({ error: "GitHub not connected" }, { status: 400 });

    const repos = await listRepos(token);

    // Get which repos the user has "opened" for agent access
    const { data: opened, error: openedErr } = await supabase
      .from("github_repos")
      .select("repo_id, opened_at")
      .eq("user_id", session.user?.email ?? "");

    // If table doesn't exist yet, just return all repos as unopened
    const openedMap = openedErr
      ? new Map()
      : new Map((opened ?? []).map((r: any) => [r.repo_id, r.opened_at]));

    return NextResponse.json({
      repos: repos.map((r) => ({
        ...r,
        opened: openedMap.has(r.id),
        openedAt: openedMap.get(r.id) ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list repos" },
      { status: 500 }
    );
  }
}
