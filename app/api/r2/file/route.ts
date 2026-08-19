import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { r2ReadRepoFile } from "@/lib/r2/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");
  const path = url.searchParams.get("path");

  if (!repo || !path) {
    return Response.json({ error: "Missing repo or path" }, { status: 400 });
  }

  try {
    const content = await r2ReadRepoFile(repo, path);
    return Response.json({ path, content, size: content.length });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read file" },
      { status: 500 },
    );
  }
}
