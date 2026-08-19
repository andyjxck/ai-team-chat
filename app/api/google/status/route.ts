import { isGoogleConnected } from "@/lib/google/auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const connected = await isGoogleConnected();
    return Response.json({ connected });
  } catch {
    return Response.json({ connected: false });
  }
}
