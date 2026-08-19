import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  r2ListPendingChanges,
  r2ListSnapshots,
  r2CleanupOldSnapshots,
  r2RejectChange,
  r2Delete,
} from "@/lib/r2/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: List pending changes and snapshots
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");

  try {
    // Clean up old snapshots on every read (cheap if nothing to delete)
    await r2CleanupOldSnapshots(repo ?? undefined);

    const [changes, snapshots] = await Promise.all([
      r2ListPendingChanges(repo ?? undefined),
      repo ? r2ListSnapshots(repo) : Promise.resolve([]),
    ]);

    return Response.json({ changes, snapshots });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list changes" },
      { status: 500 },
    );
  }
}

// POST: Accept or reject a pending change
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { action, repo, path, timestamp } = await req.json() as {
    action: "accept" | "reject";
    repo: string;
    path: string;
    timestamp: number;
  };

  if (!action || !repo || !path || !timestamp) {
    return Response.json({ error: "Missing action, repo, path, or timestamp" }, { status: 400 });
  }

  try {
    if (action === "accept") {
      // Accept: keep the new file, just delete the pending change record
      const changeKey = `changes/${repo}/${timestamp}/${path}`;
      await r2Delete(changeKey);
      return Response.json({
        success: true,
        action: "accept",
        repo,
        path,
        message: `Accepted change to ${path} in ${repo}`,
      });
    } else if (action === "reject") {
      // Reject: restore the old content and delete the pending change record
      await r2RejectChange(repo, timestamp, path);
      return Response.json({
        success: true,
        action: "reject",
        repo,
        path,
        message: `Rejected change to ${path} in ${repo} — old content restored`,
      });
    } else {
      return Response.json({ error: "Invalid action. Use 'accept' or 'reject'." }, { status: 400 });
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to process change" },
      { status: 500 },
    );
  }
}
