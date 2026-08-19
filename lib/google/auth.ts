import { google } from "googleapis";
import { supabase } from "@/db/client";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI;

export function getOAuthClient() {
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth credentials not configured");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(): string {
  const oauthClient = getOAuthClient();
  const scopes = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
  ];
  return oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  });
}

export async function exchangeCode(code: string) {
  const oauthClient = getOAuthClient();
  const { tokens } = await oauthClient.getToken(code);

  const { data: existing } = await supabase
    .from("google_tokens")
    .select("*")
    .eq("id", "singleton");

  if (existing && existing.length > 0) {
    await supabase
      .from("google_tokens")
      .update({
        access_token: tokens.access_token ?? null,
        refresh_token: tokens.refresh_token ?? existing[0].refresh_token,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "singleton");
  } else {
    await supabase.from("google_tokens").insert({
      id: "singleton",
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    });
  }

  return tokens;
}

export async function getAuthenticatedClient() {
  const { data } = await supabase.from("google_tokens").select("*").eq("id", "singleton");
  const tokenRow = data?.[0];
  if (!tokenRow || !tokenRow.access_token) {
    throw new Error("Google account not connected. Visit /api/google/connect to authorize.");
  }

  const oauthClient = getOAuthClient();
  oauthClient.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : undefined,
  });

  oauthClient.on("tokens", async (tokens) => {
    await supabase
      .from("google_tokens")
      .update({
        access_token: tokens.access_token ?? tokenRow.access_token,
        refresh_token: tokens.refresh_token ?? tokenRow.refresh_token,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "singleton");
  });

  return oauthClient;
}

export async function isGoogleConnected() {
  const { data } = await supabase.from("google_tokens").select("*").eq("id", "singleton");
  return !!data?.[0]?.access_token;
}
