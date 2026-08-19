import { supabase } from "@/db/client";
import type { Agent } from "@/db/schema-types";
import { SettingsView } from "@/components/settings/settings-view";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { data } = await supabase.from("agents").select("*");
  const allAgents = ((data ?? []) as Agent[]).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    avatar: a.avatar,
    persona: a.persona,
    tools: a.tools,
    model: a.model,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  }));

  return <SettingsView agents={allAgents} />;
}
