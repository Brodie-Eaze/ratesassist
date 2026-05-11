/**
 * Root route.
 *
 * Behaviour depends on auth state:
 *   - Authenticated → render the officer chat dashboard (Sidebar + Chat).
 *   - Unauthenticated → render the public landing page inline.
 *
 * Middleware lets "/" through without an auth gate (see middleware.ts'
 * PUBLIC_HTML_PATHS); the rendering decision lives here so the
 * authenticated dashboard never bleeds into a public response.
 */

import { headers } from "next/headers";

import { Sidebar } from "@/components/Sidebar";
import { Chat } from "@/components/Chat";
import { SESSION_HEADER } from "@/lib/auth";
import LandingPage from "./landing/page";

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

export default async function Home() {
  const h = await headers();
  const sessionHeader = h.get(SESSION_HEADER);

  if (!sessionHeader) {
    // Unauthenticated — serve the public landing page.
    return <LandingPage />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col">
        <Chat initialPrompts={PROMPTS} storageKey="ra-officer-chat" />
      </main>
    </div>
  );
}
