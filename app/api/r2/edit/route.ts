import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { r2ReadRepoFile, r2Upload } from "@/lib/r2/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: Apply a code change
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { repo, path, newContent, action } = await req.json() as {
    repo: string;
    path: string;
    newContent: string;
    action: "apply" | "preview";
  };

  if (!repo || !path || !newContent) {
    return Response.json({ error: "Missing repo, path, or newContent" }, { status: 400 });
  }

  try {
    // Read current content for diff
    let oldContent = "";
    try {
      oldContent = await r2ReadRepoFile(repo, path);
    } catch {
      // File doesn't exist yet — that's fine, it's a new file
    }

    if (action === "preview") {
      return Response.json({
        repo,
        path,
        oldContent,
        newContent,
        isNew: oldContent === "",
      });
    }

    // Apply the change
    const key = `repos/${repo}/${path}`;
    await r2Upload(key, newContent);

    return Response.json({
      success: true,
      repo,
      path,
      message: `Updated ${path} in ${repo}`,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to apply change" },
      { status: 500 },
    );
  }
}
