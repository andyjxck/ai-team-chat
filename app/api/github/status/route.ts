import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUser, getGithubToken } from "@/lib/github/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = getGithubToken();
    if (!token) {
      return NextResponse.json({ connected: false, reason: "no_token" });
    }
    const user = await getUser(token);
    return NextResponse.json({
      connected: true,
      username: user.login,
      name: user.name,
      avatar: user.avatar_url,
    });
  } catch {
    return NextResponse.json({ connected: false, reason: "invalid_token" });
  }
}
