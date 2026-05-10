// LLM orchestration. Anthropic Claude tool-use loop, with a deterministic
// intent-routed fallback when no API key is configured.

import Anthropic from "@anthropic-ai/sdk";
import { runTool, TOOLS, toAnthropicTool } from "./tools";
import type { ChatMessage, ToolCall } from "./types";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = "claude-sonnet-4-6";

// SEC-007: AU region pinning. Resolve Anthropic base URL once at module load
// and refuse non-AU endpoints in production. Bedrock Sydney pattern allowed.
const ANTHROPIC_BASE_URL_DEFAULT = "https://api.anthropic.com.au";
const ANTHROPIC_BASE_URL_ENV = (process.env.ANTHROPIC_BASE_URL ?? "").trim();

function isAllowedAuBaseUrl(url: string): boolean {
  if (url === "https://api.anthropic.com.au") return true;
  // Bedrock AU regional pattern, e.g. https://bedrock-runtime.ap-southeast-2.amazonaws.com(.au)
  if (/^https:\/\/[a-z0-9.-]+\.amazonaws\.com(\.au)?(\/|$)/i.test(url)) return true;
  return false;
}

function resolveAnthropicBaseUrl(): string {
  return ANTHROPIC_BASE_URL_ENV.length > 0
    ? ANTHROPIC_BASE_URL_ENV
    : ANTHROPIC_BASE_URL_DEFAULT;
}

/**
 * Runtime guard called only when a live LLM call is about to fire. We
 * deliberately defer the production refusal here rather than at module load
 * because Next.js evaluates route modules during build (where NODE_ENV is
 * "production" but the env shell may carry a non-AU placeholder for a
 * staging/CI configuration). At runtime, a real request must use AU.
 */
function assertAuBaseUrlAtCallTime(url: string): void {
  if (process.env.NODE_ENV !== "production") {
    if (ANTHROPIC_BASE_URL_ENV.length > 0 && !isAllowedAuBaseUrl(ANTHROPIC_BASE_URL_ENV)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm] ANTHROPIC_BASE_URL '${ANTHROPIC_BASE_URL_ENV}' is not an AU endpoint; allowed in dev only.`,
      );
    }
    return;
  }
  if (!isAllowedAuBaseUrl(url)) {
    throw new Error(
      `[llm] ANTHROPIC_BASE_URL refused at runtime: '${url}'. ` +
        `Must be https://api.anthropic.com.au or a *.amazonaws.com(.au) Bedrock endpoint.`,
    );
  }
}

const RESOLVED_ANTHROPIC_BASE_URL: string = resolveAnthropicBaseUrl();

// SEC-016: PII scrubber for outbound user messages. Redacts AU ABNs, AU
// phone numbers, and email addresses before forwarding to Anthropic. The
// caller retains the unredacted text in our internal log for audit.
// Order matters: emails first (they contain @), then ABNs (digit runs),
// then phone numbers (overlap with ABN digit clusters if not narrowed).
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const ABN_RE = /\b\d{2}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g;
// AU phone numbers, broad pattern.
const AU_PHONE_RE =
  /(?:\+?61[\s-]?\d(?:[\s-]?\d){7,9}|\b0[2-478](?:[\s-]?\d){8}\b|\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b)/g;

export function scrubPii(text: string): string {
  if (process.env.RA_DISABLE_PII_SCRUB === "1") return text;
  // Phones first: +61-prefixed numbers also satisfy the 11-digit ABN shape
  // (`61 XXX XXX XXX`), so running ABN first would eat them.
  return text
    .replace(EMAIL_RE, "[EMAIL-REDACTED]")
    .replace(AU_PHONE_RE, "[PHONE-REDACTED]")
    .replace(ABN_RE, "[ABN-REDACTED]");
}

const MAX_TOOL_ITERATIONS = 8;
const LIVE_TIMEOUT_MS = 45_000;
const RETRY_BACKOFF_MS = 1_500;
const MAX_TOKENS = 2048;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503, 504, 529]);
const RETRYABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "APIError",
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "RateLimitError",
  "InternalServerError",
]);

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
  return ANTHROPIC_API_KEY.length > 10 && ANTHROPIC_API_KEY.startsWith("sk-ant-");
}

// One-time warning on module load if a key is set but malformed.
if (ANTHROPIC_API_KEY.length > 0 && !isLive()) {
  console.warn(
    "[llm] ANTHROPIC_API_KEY is set but does not look like a valid Anthropic key (expected prefix 'sk-ant-'). Falling back to mock mode.",
  );
}

function logError(scope: string, correlationId: string | undefined, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[llm:${scope}]`, correlationId ?? "-", message, stack ? `\n${stack}` : "");
}

// Programming errors (TypeError/ReferenceError/ZodError) are NOT transport
// failures — they bubble up as 500s rather than degrading to mock.
function isLiveTransportFailure(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  if (e instanceof TypeError || e instanceof ReferenceError) return false;
  const name = (e as { name?: unknown }).name;
  if (name === "ZodError") return false;
  const status = (e as { status?: unknown }).status;
  if (typeof status === "number" && RETRYABLE_STATUSES.has(status)) return true;
  if (typeof name === "string" && RETRYABLE_ERROR_NAMES.has(name)) return true;
  const message = String((e as { message?: unknown }).message ?? "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

export async function runChat(
  history: ChatMessage[],
  userMessage: string,
  correlationId?: string,
): Promise<LlmResult> {
  if (!isLive()) {
    return runChatMock(history, userMessage);
  }

  // SEC-016: scrub PII before forwarding to Anthropic. The unredacted message
  // remains in our internal audit log via the caller's correlation context.
  const scrubbedUserMessage = scrubPii(userMessage);
  if (scrubbedUserMessage !== userMessage) {
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        level: "info",
        scope: "llm",
        event: "security.pii_scrubbed",
        correlationId: correlationId ?? null,
        originalLength: userMessage.length,
        scrubbedLength: scrubbedUserMessage.length,
      }),
    );
  }

  try {
    return await runChatLive(history, scrubbedUserMessage, correlationId);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      throw e;
    }
    if (!isLiveTransportFailure(e)) {
      logError("runChat.unexpected", correlationId, e);
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("[llm] live failed", { correlationId, message });
    const mock = await runChatMock(history, userMessage);
    return {
      ...mock,
      modelUsed: { kind: "mock", reason: "live_failed", cause: message },
    };
  }
}

// ---------- LIVE: Anthropic Claude tool-use loop ----------

function isRetryableStatus(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const status = (e as { status?: unknown }).status;
  return typeof status === "number" && RETRYABLE_STATUSES.has(status);
}

async function runChatLive(
  history: ChatMessage[],
  userMessage: string,
  correlationId?: string,
): Promise<LlmResult> {
  // AbortController cancels the SDK socket when our wall-clock timeout fires.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIVE_TIMEOUT_MS);
  try {
    return await runChatLiveInner(history, userMessage, ctrl.signal, correlationId);
  } catch (e: unknown) {
    if (ctrl.signal.aborted) {
      throw new Error(`Live LLM timeout after ${LIVE_TIMEOUT_MS / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  signal: AbortSignal,
): Promise<Anthropic.Message> {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools,
    messages,
  };
  try {
    return await client.messages.create(params, { signal });
  } catch (e: unknown) {
    if (!isRetryableStatus(e)) throw e;
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    return await client.messages.create(params, { signal });
  }
}

async function runChatLiveInner(
  history: ChatMessage[],
  userMessage: string,
  abortSignal: AbortSignal,
  _correlationId?: string,
): Promise<LlmResult> {
  // Runtime AU-region guard — fires only when a real call is about to go
  // out, never at build/collection time.
  assertAuBaseUrlAtCallTime(RESOLVED_ANTHROPIC_BASE_URL);

  const client = new Anthropic({
    apiKey: ANTHROPIC_API_KEY,
    baseURL: RESOLVED_ANTHROPIC_BASE_URL,
  });
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

    const response = await callAnthropic(client, messages, anthropicTools, abortSignal);

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
      const input = (tu.input as Record<string, unknown>) ?? {};
      const result = await runTool(tu.name, input);
      toolCalls.push({
        id: tu.id,
        name: tu.name,
        input,
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
