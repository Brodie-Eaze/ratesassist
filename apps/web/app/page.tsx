import { Sidebar } from "@/components/Sidebar";
import { Chat } from "@/components/Chat";

const PROMPTS = [
  "Give me today's briefing",
  "Run a mining mismatch audit across all councils",
  "Pull up TPS-1102-44",
  "Generate evidence pack for KAL-4401-12",
  "List overdue accounts",
  "Verify ABN 32 614 882 110",
  "Draft a final notice for TPS-3041-12",
  "What can you do?",
];

export default function Home() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col">
        <Chat initialPrompts={PROMPTS} storageKey="ra-officer-chat" />
      </main>
    </div>
  );
}
