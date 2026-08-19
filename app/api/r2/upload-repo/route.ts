import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { r2Upload } from "@/lib/r2/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { repoName, files } = await req.json() as {
    repoName: string;
    files: { path: string; content: string }[];
  };

  if (!repoName || !files || !Array.isArray(files)) {
    return Response.json({ error: "Missing repoName or files" }, { status: 400 });
  }

  let uploaded = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      const key = `repos/${repoName}/${file.path}`;
      await r2Upload(key, file.content);
      uploaded++;
    } catch (err) {
      errors.push(`${file.path}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return Response.json({ uploaded, total: files.length, errors });
}
