"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Wrench, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Markdown } from "./Markdown";
import type { ChatMessage, ToolCall } from "@/lib/types";
import type { ModelUsed } from "@/lib/llm";
import { cn } from "@/lib/utils";

type ChatMessageWithMeta = ChatMessage & { meta?: ModelUsed };

type ChatProps = {
  initialPrompts?: string[];
  storageKey?: string;
  citizenMode?: boolean;
};

export function Chat({ initialPrompts = [], storageKey = "ra-officer-chat", citizenMode = false }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessageWithMeta[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load history
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      try {
        setMessages(JSON.parse(stored));
      } catch {}
    }
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d) => setLive(!!d.live))
      .catch(() => setLive(false));
  }, [storageKey]);

  // Persist history
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, storageKey]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: messages, message: text }),
      });
      // Parse defensively: an error response may not be JSON, and a blank
      // body must never surface as a silent "(no response)" bubble. A non-2xx
      // status (rate limit, kill switch, validation, server error) is turned
      // into a visible, screen-reader-announced message that carries the
      // correlationId so an officer can quote it to support.
      const data: {
        content?: string;
        toolCalls?: ToolCall[];
        modelUsed?: ModelUsed;
        code?: string;
        message?: string;
        correlationId?: string;
      } = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code = typeof data.code === "string" ? data.code : `http_${res.status}`;
        const friendly =
          code === "chat_disabled"
            ? "The AI assistant is temporarily disabled. The rest of RatesAssist is unaffected."
            : code === "rate_limited"
              ? "You're sending messages too quickly — please wait a moment and try again."
              : typeof data.message === "string" && data.message.length > 0
                ? data.message
                : `The assistant couldn't complete that request (error ${res.status}).`;
        setMessages([
          ...history,
          {
            id: `e_${Date.now()}`,
            role: "assistant",
            content: data.correlationId
              ? `${friendly}\n\n_Reference: ${data.correlationId}_`
              : friendly,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      const reply: ChatMessageWithMeta = {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: data.content || "(no response)",
        toolCalls: data.toolCalls,
        timestamp: new Date().toISOString(),
        meta: data.modelUsed as ModelUsed | undefined,
      };
      setMessages([...history, reply]);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setMessages([
        ...history,
        {
          id: `e_${Date.now()}`,
          role: "assistant",
          content: `Error: ${message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-ink-200 bg-white">
        <div className="flex items-center gap-2 text-sm text-ink-700">
          <Sparkles className="w-4 h-4 text-accent-500" />
          <span className="font-medium">
            {citizenMode ? "RatesChat (citizen)" : "RatesAssist (officer)"}
          </span>
          {live === true && (
            <span className="badge bg-success-50 text-success-700 ml-2">Live · Claude</span>
          )}
          {live === false && (
            <span className="badge bg-warn-50 text-warn-700 ml-2">Demo · Mock LLM</span>
          )}
        </div>
        <button onClick={reset} className="text-xs text-ink-500 hover:text-ink-900">
          Clear conversation
        </button>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        aria-busy={busy}
        className="flex-1 overflow-y-auto chat-scroll bg-ink-50 px-6 py-4"
      >
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && initialPrompts.length > 0 && (
            <div className="text-center pt-12 pb-4">
              <div className="text-2xl font-semibold text-ink-900 mb-1">
                {citizenMode ? "How can we help?" : "What would you like to do?"}
              </div>
              <div className="text-sm text-ink-500 mb-6">
                {citizenMode
                  ? "Ask about your rates balance, set up direct debit, or apply for a rebate."
                  : "Try one of the suggestions, or ask anything about your portfolio."}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl mx-auto">
                {initialPrompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    className="text-left px-4 py-3 rounded-md border border-ink-200 bg-white text-sm hover:border-accent-400 hover:bg-accent-50 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}

          {busy && <BusyIndicator />}
        </div>
      </div>

      <div className="border-t border-ink-200 bg-white px-6 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="max-w-3xl mx-auto flex gap-2"
        >
          <input
            className="input"
            placeholder={
              citizenMode
                ? "Ask about your rates…"
                : "Ask anything — search, draft, audit, summarise…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <button type="submit" className="btn-primary" disabled={busy || !input.trim()}>
            <Send className="w-4 h-4" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function Message({ message }: { message: ChatMessageWithMeta }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-accent-600 text-white rounded-lg rounded-br-sm px-4 py-2 text-sm">
          {message.content}
        </div>
      </div>
    );
  }
  const showFallbackBanner =
    message.meta?.kind === "mock" && message.meta.reason === "live_failed";
  return (
    <div className="flex">
      <div className="max-w-[90%] bg-white border border-ink-200 rounded-lg rounded-bl-sm px-4 py-3">
        {showFallbackBanner && message.meta?.kind === "mock" && (
          <div className="mb-2 text-xs px-2 py-1.5 rounded border border-red-200 bg-red-50 text-red-700">
            ⚠ Falling back to deterministic mode — live LLM call failed
            {message.meta.cause ? ` (${message.meta.cause})` : ""}
          </div>
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsBadge toolCalls={message.toolCalls} />
        )}
        <Markdown>{message.content}</Markdown>
      </div>
    </div>
  );
}

function ToolCallsBadge({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-700"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Wrench className="w-3 h-3" />
        <span>
          {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"} ·{" "}
          {toolCalls.reduce((s, t) => s + t.durationMs, 0)}ms
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 pl-4 border-l-2 border-ink-200">
          {toolCalls.map((tc) => (
            <div key={tc.id} className="text-xs">
              <code className="bg-ink-100 px-1.5 py-0.5 rounded text-accent-700 font-mono">
                {tc.name}
              </code>
              <span className="text-ink-500 ml-2">({tc.durationMs}ms)</span>
              {Object.keys(tc.input).length > 0 && (
                <code className="block mt-0.5 text-ink-500 text-[11px] font-mono">
                  {JSON.stringify(tc.input)}
                </code>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BusyIndicator() {
  return (
    <div className="flex" role="status" aria-label="Assistant is working">
      <div className="bg-white border border-ink-200 rounded-lg rounded-bl-sm px-4 py-3 text-sm text-ink-500">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className={cn("w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse")}></span>
            <span
              className={cn("w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse")}
              style={{ animationDelay: "0.15s" }}
            ></span>
            <span
              className={cn("w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse")}
              style={{ animationDelay: "0.3s" }}
            ></span>
          </div>
          <span>Working…</span>
        </div>
      </div>
    </div>
  );
}
