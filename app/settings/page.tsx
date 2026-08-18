import { db, schema } from "@/db/client";
import { SettingsView } from "@/components/settings/settings-view";

export default async function SettingsPage() {
  const allAgents = await db.select().from(schema.agents);
  return <SettingsView agents={allAgents} />;
}
