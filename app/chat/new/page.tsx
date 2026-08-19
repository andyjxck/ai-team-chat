import { supabase } from "@/db/client";
import type { Agent } from "@/db/schema-types";
import { NewChatForm } from "@/components/new-chat-form";

export default async function NewChatPage() {
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
  return <NewChatForm agents={allAgents} />;
}
