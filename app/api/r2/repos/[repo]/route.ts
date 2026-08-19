import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { r2List, r2Delete } from "@/lib/r2/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ repo: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { repo: repoParam } = await params;
  const repo = decodeURIComponent(repoParam);

  if (!repo) {
    return Response.json({ error: "Missing repo name" }, { status: 400 });
  }

  try {
    // List all files in the repo
    const files = await r2List(`repos/${repo}/`, 10000);
    let deleted = 0;
    for (const file of files) {
      await r2Delete(file.key);
      deleted++;
    }

    // Also delete versions
    const versions = await r2List(`.versions/repos/${repo}/`, 10000);
    for (const v of versions) {
      await r2Delete(v.key);
    }

    return Response.json({ success: true, deleted, repo });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete repo" },
      { status: 500 },
    );
  }
}
