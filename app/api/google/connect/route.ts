import { getAuthUrl } from "@/lib/google/auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return new Response("Unauthorized", { status: 401 });

  try {
    const url = getAuthUrl();
    return Response.redirect(url);
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : "Google OAuth not configured",
      { status: 500 },
    );
  }
}
