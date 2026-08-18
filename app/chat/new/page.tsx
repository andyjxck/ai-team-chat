import { db, schema } from "@/db/client";
import { NewChatForm } from "@/components/new-chat-form";

export default async function NewChatPage() {
  const allAgents = await db.select().from(schema.agents);

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-lg space-y-6">
        <div>
          <h2 className="text-xl font-bold">New Chat</h2>
          <p className="text-sm text-muted-foreground">
            Pick which team members to include and how they should respond.
          </p>
        </div>
        <NewChatForm agents={allAgents} />
      </div>
    </div>
  );
}
