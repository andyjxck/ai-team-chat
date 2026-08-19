import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { r2RejectChange, r2AcceptChange, r2RestoreSnapshot, r2ListSnapshots } from "@/lib/r2/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: Accept, reject, or rollback
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await req.json() as {
    action: "accept" | "reject" | "rollback_snapshot";
    repo?: string;
    path?: string;
    timestamp?: number;
    snapshotId?: string;
  };

  if (!body.action || !body.repo) {
    return Response.json({ error: "Missing action or repo" }, { status: 400 });
  }

  try {
    if (body.action === "reject") {
      // Reject a pending change — restore old content
      if (!body.path || !body.timestamp) {
        return Response.json({ error: "Missing path or timestamp" }, { status: 400 });
      }
      const restored = await r2RejectChange(body.repo, body.timestamp, body.path);
      return Response.json({ success: true, action: "rejected", repo: body.repo, path: body.path, restoredContent: restored });
    }

    if (body.action === "accept") {
      // Accept a pending change — just delete the change record
      if (!body.path || !body.timestamp) {
        return Response.json({ error: "Missing path or timestamp" }, { status: 400 });
      }
      await r2AcceptChange(body.repo, body.timestamp, body.path);
      return Response.json({ success: true, action: "accepted", repo: body.repo, path: body.path });
    }

    if (body.action === "rollback_snapshot") {
      // Rollback to a full snapshot
      if (!body.snapshotId) {
        return Response.json({ error: "Missing snapshotId" }, { status: 400 });
      }
      const result = await r2RestoreSnapshot(body.repo, body.snapshotId);
      return Response.json({ success: true, action: "rolled_back", repo: body.repo, snapshotId: body.snapshotId, restored: result.restored });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 500 },
    );
  }
}

// GET: List snapshots for a repo
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");

  if (!repo) {
    return Response.json({ error: "Missing repo" }, { status: 400 });
  }

  try {
    const snapshots = await r2ListSnapshots(repo);
    return Response.json({ snapshots });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list snapshots" },
      { status: 500 },
    );
  }
}
