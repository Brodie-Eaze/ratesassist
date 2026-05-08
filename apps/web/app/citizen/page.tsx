import { Wordmark } from "@/components/Brand";
import { Chat } from "@/components/Chat";

const PROMPTS = [
  "What's the rates balance for 12 Stadium Road, Tom Price?",
  "How do I set up direct debit?",
  "I need a section 6.76 certificate for a property settlement",
  "Am I eligible for the pensioner rebate?",
  "How do I dispute my valuation?",
];

export default function CitizenPage() {
  return (
    <div className="flex flex-col h-screen">
      <header className="bg-white border-b border-ink-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wordmark size="md" />
          <span className="text-ink-300">·</span>
          <span className="text-sm text-ink-700 font-medium">Ratepayer Self-Service</span>
          <span className="badge bg-accent-100 text-accent-700">RatesChat</span>
        </div>
        <div className="text-xs text-ink-500">
          Shire of Tom Price · Western Australia
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Chat
          initialPrompts={PROMPTS}
          storageKey="ra-citizen-chat"
          citizenMode={true}
        />
      </main>
      <footer className="bg-white border-t border-ink-200 px-6 py-3 text-xs text-ink-500 flex items-center justify-between">
        <div>
          You are interacting with an AI assistant. Statutory matters are reviewed by
          council staff before action.
        </div>
        <div className="flex gap-3">
          <a href="/citizen/privacy" className="hover:text-ink-700">Privacy</a>
          <a href="/citizen/accessibility" className="hover:text-ink-700">Accessibility</a>
          <a href="tel:0891888888" className="hover:text-ink-700">Speak to a person</a>
        </div>
      </footer>
    </div>
  );
}
