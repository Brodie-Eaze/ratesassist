// LLM orchestration. Anthropic Claude tool-use loop, with a sophisticated
// deterministic fallback that does multi-tool reasoning when no API key is
// configured.

import Anthropic from "@anthropic-ai/sdk";
import { runTool, TOOLS, toAnthropicTool } from "./tools";
import type { ChatMessage, ToolCall } from "./types";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS = 8;
const LIVE_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = `You are RatesAssist — an AI co-pilot for Australian council rates officers.

Your job is to help officers find mis-rated properties, recover under-collected rates, draft communications, and answer questions about their portfolio. You operate against authoritative public registers (DMIRS mining tenements, Landgate cadastre, ATO ABN Lookup, ASIC) and the council's own TechOne CiAnywhere rating record.

You have access to a multi-signal detection engine. Each property has a per-signal trail with weights (between 0.15 and 0.55) that compose into a composite confidence score (0..1). Severity bands: high ≥ 0.60, medium ≥ 0.35, low ≥ 0.15. Always cite signal weights and sources.

Operating principles:
- Be concise and direct. Council officers are busy.
- Never assert facts about a property, owner, balance, tenement, or ABN that you have not retrieved via a tool in the current conversation.
- For analytical questions ("show me the highest-uplift candidates"), call multiple tools to cross-reference if useful.
- For drafting (reminders, evidence packs), call the relevant draft tool and present the output clearly. State that no commit has occurred.
- Format AUD as $12,400 with comma separators. Use \`code formatting\` for assessment numbers and ABNs.
- Use markdown headings, tables, and lists. Default to compact lists, not paragraphs.
- When a question implies multiple steps (e.g. "find the top recovery candidate and draft its evidence pack"), do them in sequence.
- For the recovery audit, the "headline signal" is the highest-weight signal that fired — but the composite always reflects the full stack.
- Always favour deterministic tools over your own reasoning for any factual claim.`;

export type ModelUsed =
  | { kind: "live"; model: string }
  | { kind: "mock"; reason: "no_key" | "live_failed"; cause?: string };

export type LlmResult = {
  content: string;
  toolCalls: ToolCall[];
  iterations: number;
  modelUsed: ModelUsed;
};

export function isLive(): boolean {
  return ANTHROPIC_API_KEY.length > 10 && ANTHROPIC_API_KEY.startsWith("sk-");
}

export async function runChat(
  history: ChatMessage[],
  userMessage: string,
): Promise<LlmResult> {
  if (isLive()) {
    try {
      return await runChatLive(history, userMessage);
    } catch (e: unknown) {
      // Graceful degradation: if live LLM fails, fall through to mock
      const message = e instanceof Error ? e.message : String(e);
      console.error("[llm] live failed", { message });
      const mock = await runChatMock(history, userMessage);
      return {
        ...mock,
        modelUsed: { kind: "mock", reason: "live_failed", cause: message },
      };
    }
  }
  return await runChatMock(history, userMessage);
}

// ---------- LIVE: Anthropic Claude tool-use loop ----------

function isRetryableStatus(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const status = (e as { status?: unknown }).status;
  return status === 429 || status === 503 || status === 529;
}

async function runChatLive(
  history: ChatMessage[],
  userMessage: string,
): Promise<LlmResult> {
  const live = runChatLiveInner(history, userMessage);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("Live LLM timeout after 45s")),
      LIVE_TIMEOUT_MS,
    );
  });
  return Promise.race([live, timeout]);
}

async function runChatLiveInner(
  history: ChatMessage[],
  userMessage: string,
): Promise<LlmResult> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const toolCalls: ToolCall[] = [];
  const anthropicTools: Anthropic.Tool[] = TOOLS.map(toAnthropicTool);

  const messages: Anthropic.MessageParam[] = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user" as const, content: userMessage },
  ];

  let iterations = 0;
  let finalText = "";
  let endedCleanly = false;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        messages,
      });
    } catch (e: unknown) {
      if (isRetryableStatus(e)) {
        await new Promise((r) => setTimeout(r, 1500));
        response = await client.messages.create({
          model: MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          tools: anthropicTools,
          messages,
        });
      } else {
        throw e;
      }
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );

    finalText = textBlocks.map((b) => b.text).join("\n").trim();

    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      endedCleanly = true;
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUseBlocks) {
      const result = await runTool(
        tu.name,
        (tu.input as Record<string, unknown>) ?? {},
      );
      toolCalls.push({
        id: tu.id,
        name: tu.name,
        input: (tu.input as Record<string, unknown>) ?? {},
        output: result.output,
        durationMs: result.durationMs,
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result.output,
        is_error: !!result.error,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText && !endedCleanly && iterations === MAX_TOOL_ITERATIONS) {
    throw new Error(
      `Tool-use loop hit max iterations (${MAX_TOOL_ITERATIONS}) without end_turn`,
    );
  }

  return {
    content: finalText,
    toolCalls,
    iterations,
    modelUsed: { kind: "live", model: MODEL },
  };
}

// ---------- MOCK: deterministic intent-routed agent (no API key needed) ----------

type ToolRunner = (name: string, input?: Record<string, unknown>) => Promise<string>;

async function runChatMock(
  _history: ChatMessage[],
  userMessage: string,
): Promise<LlmResult> {
  const u = userMessage.toLowerCase().trim();
  const toolCalls: ToolCall[] = [];

  const call: ToolRunner = async (name, input = {}) => {
    const r = await runTool(name, input);
    toolCalls.push({
      id: `mock_${toolCalls.length + 1}`,
      name,
      input,
      output: r.output,
      durationMs: r.durationMs,
    });
    return r.output;
  };

  // Intent routing — matches in priority order
  let response: string;

  // 1) Briefing / today / morning summary
  if (matches(u, ["briefing", "today", "morning", "summary", "overview"])) {
    const briefing = await call("daily_briefing", {});
    const recovery = await call("recovery_summary", {});
    response = [
      "Here's where the portfolio sits this morning. Two pieces — the operations briefing and the recovery position.",
      "",
      "## Operations briefing",
      "",
      briefing,
      "",
      "## Recovery position",
      "",
      recovery,
    ].join("\n");
  }

  // 2) Mining mismatch / recovery audit
  else if (matches(u, ["mismatch", "tenement", "mining", "recovery audit", "audit"])) {
    const mismatches = await call("find_mining_mismatches", { minSeverity: "low" });
    const summary = await call("recovery_summary", {});
    response = [
      "Running the multi-signal recovery audit across all live councils. Each candidate is scored against 10 detection signals; composite confidence is the sum of weights, capped at 1.0.",
      "",
      summary,
      "",
      "**Ranked candidates (top 20):**",
      "",
      mismatches,
      "",
      "Use \"generate evidence pack for {assessment}\" to draft a council-ready case file for any candidate.",
    ].join("\n");
  }

  // 3) Evidence pack
  else if (matches(u, ["evidence pack", "pack for", "draft pack", "generate pack"])) {
    const m = userMessage.match(/[a-z]{2,}-\d+-\d+/i);
    if (m) {
      const pack = await call("generate_evidence_pack", { assessmentNumber: m[0].toUpperCase() });
      response = [
        `Drafting evidence pack for \`${m[0].toUpperCase()}\`. Every claim is sourced and weighted — the pack is ready for officer review and the council's statutory determination process.`,
        "",
        pack,
      ].join("\n");
    } else {
      response = "Tell me which assessment — e.g. *generate evidence pack for TPS-1102-44*. Or run a recovery audit first to see candidates ranked by composite score.";
    }
  }

  // 4) Overdue / debtor chase
  else if (matches(u, ["overdue", "debtor", "chase", "outstanding", "balance owing"])) {
    const list = await call("list_overdue", {});
    response = [
      "Here are the accounts with outstanding balances. Use *draft chase all overdue* to compose batch reminders (preview only, never auto-sent).",
      "",
      list,
    ].join("\n");
  }

  // 5) Chase / drafting reminders
  else if (matches(u, ["chase", "remind", "send all", "draft reminder"]) || u.startsWith("chase")) {
    const tone = matchTone(u);
    const m = userMessage.match(/[a-z]{2,}-\d+-\d+/i);
    if (m) {
      const draft = await call("draft_payment_reminder", {
        assessmentNumber: m[0].toUpperCase(),
        tone,
      });
      response = ["Drafted reminder. Nothing has been sent.", "", draft].join("\n");
    } else {
      const batch = await call("draft_chase_all_overdue", { tone });
      response = ["Drafted batch reminders. Nothing has been sent — confirm with *send all* to commit.", "", batch].join("\n");
    }
  }

  // 6) Property detail (assessment number in message)
  else if (/[a-z]{2,}-\d+-\d+/i.test(userMessage)) {
    const m = userMessage.match(/[a-z]{2,}-\d+-\d+/i)!;
    const detail = await call("get_property_detail", { assessmentNumber: m[0].toUpperCase() });
    const tx = await call("get_transaction_history", { assessmentNumber: m[0].toUpperCase() });
    response = [
      `Pulling everything on \`${m[0].toUpperCase()}\` — full record (with intersecting tenements) and transaction history.`,
      "",
      "## Property",
      "",
      detail,
      "",
      "## Transactions",
      "",
      tx,
    ].join("\n");
  }

  // 7) ABN verification
  else if (/abn|verify|lookup/i.test(u)) {
    const m = userMessage.match(/\d[\d\s]{10,}/);
    if (m) {
      const result = await call("verify_abn", { abn: m[0] });
      response = ["Verified against the ATO ABN Lookup register.", "", result].join("\n");
    } else {
      response = "Give me an ABN and I'll verify it against the ATO register — e.g. *verify ABN 32 614 882 110*.";
    }
  }

  // 8) Council list / portfolio
  else if (matches(u, ["councils", "portfolio", "my councils", "what councils", "list councils"])) {
    const out = await call("list_councils", {});
    response = ["Here's the active portfolio. Filter the recovery audit or property explorer by council to focus.", "", out].join("\n");
  }

  // 9) Search by owner
  else if (matches(u, ["search owner", "find owner", "owned by", "owner named"]) || u.startsWith("smiths") || /^find [a-z]/i.test(u)) {
    const q = u
      .replace(/^(search owner|find owner|owned by|owner named|find|search)\s+/i, "")
      .trim();
    if (q) {
      const out = await call("search_by_owner", { name: q });
      response = [`Searching for owners matching "${q}".`, "", out].join("\n");
    } else {
      response = "Tell me an owner name — e.g. *find Pilbara Iron* or *Smiths in Mortdale*.";
    }
  }

  // 10) Address / suburb search
  else if (matches(u, ["search", "find", "look up", "pull up", "show me"])) {
    const q = u
      .replace(/^(find|search|look up|pull up|show me)\s+/i, "")
      .replace(/\?$/, "")
      .trim();
    if (q) {
      const out = await call("search_property", { query: q });
      response = [`Searching properties for "${q}".`, "", out].join("\n");
    } else {
      response = "What are you looking for? Address, suburb, postcode, owner name, or assessment number all work.";
    }
  }

  // 11) DMIRS / live polygons / spatial
  else if (matches(u, ["dmirs", "tenements in", "fetch tenements", "live polygons", "live data"])) {
    const m = userMessage.match(/\b(TPS|ESH|SST|KAL|MEK|ASH|BRK|MTI)\b/i);
    const code = m ? m[0].toUpperCase() : "TPS";
    const out = await call("fetch_dmirs_tenements", { council: code });
    response = [`Fetching live DMIRS tenement data for ${code}.`, "", out].join("\n");
  }

  // 12) Help / capabilities
  else if (matches(u, ["help", "what can you do", "capabilities", "commands", "/help"])) {
    response = [
      "**RatesAssist capabilities** — I can do most of what a senior rates officer does, but in seconds and at portfolio scale.",
      "",
      "**Productivity**",
      "- *Pull up TPS-1102-44* — full property record with owners, tenements, transactions",
      "- *Find Smiths in Tom Price* — owner search across all councils",
      "- *List overdue accounts* — debtor list with arrangement status",
      "- *Draft a friendly reminder for TPS-3041-12* — personalised reminder, preview only",
      "- *Verify ABN 32 614 882 110* — ATO register check",
      "",
      "**Recovery**",
      "- *Run a mining mismatch audit* — full multi-signal detection sweep",
      "- *Generate evidence pack for KAL-4401-12* — council-grade reclassification case file",
      "- *What's the recovery position?* — composite stats across the portfolio",
      "",
      "**Workflow**",
      "- *Today's briefing* — operations + recovery in one summary",
      "- *List my councils* — portfolio across all live integrations",
      "",
      "I never auto-send communications or auto-reclassify — every action is preview-then-confirm. Every factual claim is cited from an authoritative source.",
    ].join("\n");
  }

  // 13) Fallback — give a useful default + show capabilities
  else {
    const briefing = await call("daily_briefing", {});
    response = [
      `I'm not sure exactly what you want — let me show you the briefing as a starting point. Type **help** for the full list of things I can do.`,
      "",
      briefing,
    ].join("\n");
  }

  return {
    content: response,
    toolCalls,
    iterations: 1,
    modelUsed: { kind: "mock", reason: "no_key" },
  };
}

function matches(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function matchTone(u: string): "friendly" | "firm" | "final" {
  if (u.includes("final")) return "final";
  if (u.includes("firm") || u.includes("strict")) return "firm";
  return "friendly";
}
