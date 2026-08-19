import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { r2ListRepos, r2ListRepoFiles } from "@/lib/r2/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const repo = url.searchParams.get("repo");

  try {
    if (repo) {
      const files = await r2ListRepoFiles(repo);
      return Response.json({
        files: files.map((f) => ({
          path: f.key.replace(`repos/${repo}/`, ""),
          size: f.size,
          lastModified: f.lastModified?.toISOString(),
        })),
      });
    }
    const repos = await r2ListRepos();
    return Response.json({ repos });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "R2 not configured" },
      { status: 500 },
    );
  }
}
