import { NextRequest } from "next/server";
import { exchangeCode } from "@/lib/google/auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  try {
    await exchangeCode(code);
    return Response.redirect(new URL("/chat/dm-eve", req.url));
  } catch (err) {
    return new Response(
      `Failed to connect Google: ${err instanceof Error ? err.message : "unknown error"}`,
      { status: 500 },
    );
  }
}
