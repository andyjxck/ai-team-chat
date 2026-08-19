import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/db/client";

export const dynamic = "force-dynamic";

// Toggle a repo open/closed for agent access
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { repoId, repoName, owner, opened } = await req.json();
    if (!repoId || !repoName || !owner) {
      return NextResponse.json({ error: "Missing repoId, repoName, or owner" }, { status: 400 });
    }

    const userId = session.user?.email ?? "";

    if (opened) {
      // Open the repo for agent access
      const { error } = await supabase
        .from("github_repos")
        .upsert({
          user_id: userId,
          repo_id: repoId,
          repo_name: repoName,
          owner,
          opened_at: new Date().toISOString(),
        }, { onConflict: "user_id,repo_id" });

      // If table doesn't exist, just succeed — the repo list will use the token directly
      if (error && !error.message.includes("does not exist") && error.code !== "PGRST205") {
        throw error;
      }
    } else {
      // Close the repo
      const { error } = await supabase
        .from("github_repos")
        .delete()
        .eq("user_id", userId)
        .eq("repo_id", repoId);

      if (error && !error.message.includes("does not exist") && error.code !== "PGRST205") {
        throw error;
      }
    }

    return NextResponse.json({ success: true, opened });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to toggle repo" },
      { status: 500 }
    );
  }
}
