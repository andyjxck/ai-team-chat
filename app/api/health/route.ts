export async function GET() {
  const keys = [
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GROQ_API_KEY",
    "SERPER_API_KEY",
    "GOOGLE_CLIENT_ID",
    "X_API_KEY",
    "LINKEDIN_CLIENT_ID",
    "INSTAGRAM_ACCESS_TOKEN",
    "FACEBOOK_PAGE_ID",
  ];

  const status: Record<string, boolean> = {};
  let allKeysOk = true;
  for (const key of keys) {
    const val = process.env[key];
    status[key] = !!val && !val.startsWith("replace_with_");
    if (!status[key]) {
      allKeysOk = false;
    }
  }

  return Response.json({
    ok: allKeysOk,
    model: process.env.AI_MODEL_ID ?? "google/gemini-2.0-flash-exp",
    keys: status,
  });
}
