// Tool catalogue exposed to the LLM. Each tool maps to a deterministic handler
// over the data layer. Mirrors the MCP server tool-set so the same logic
// applies whether the LLM calls via Anthropic tool-use or via MCP.

import {
  COUNCILS,
  PROPERTIES,
  getCouncil,
  getOverdueProperties,
  getOwner,
  getOwnersForProperty,
  getProperty,
  getTenementsForAssessment,
  getTransactions,
  searchByOwner,
  searchProperties,
} from "./data";
import { buildEvidencePack, findMismatches, recoveryStats } from "./recovery";
import { fetchDmirsTenementsForCouncil } from "./dmirs";
import { lookupAbn } from "./abn";

export type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

// ---------- Schemas ----------

export const TOOLS: ToolDef[] = [
  {
    name: "search_property",
    description:
      "Search properties by address fragment, suburb, postcode, or assessment number across the user's council portfolio.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (partial address, suburb, or assessment number).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_by_owner",
    description: "Find properties by owner name (partial OK). Optional suburb filter.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        suburb: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_property_detail",
    description:
      "Full record for one property — owner(s), valuation, balance, payment status, notes, intersecting tenements.",
    input_schema: {
      type: "object",
      properties: {
        assessmentNumber: { type: "string" },
      },
      required: ["assessmentNumber"],
    },
  },
  {
    name: "get_transaction_history",
    description: "Transaction history (levies, payments, adjustments, interest) for a property.",
    input_schema: {
      type: "object",
      properties: { assessmentNumber: { type: "string" } },
      required: ["assessmentNumber"],
    },
  },
  {
    name: "list_overdue",
    description: "List all properties with an outstanding rates balance.",
    input_schema: {
      type: "object",
      properties: {
        council: { type: "string", description: "Optional council code" },
      },
    },
  },
  {
    name: "find_mining_mismatches",
    description:
      "Cross-reference rated properties against active WA mining tenements (DMIRS data) to surface candidates whose rating classification appears mis-aligned with actual land use. Returns ranked list with confidence and estimated annual uplift. THIS IS THE HEADLINE RECOVERY TOOL.",
    input_schema: {
      type: "object",
      properties: {
        council: { type: "string" },
        minSeverity: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
  },
  {
    name: "generate_evidence_pack",
    description:
      "Produce a council-grade reclassification evidence pack for a mining-mismatch candidate. Returns a structured markdown document with all statutory citations, owner details, draft notice text, and audit trail.",
    input_schema: {
      type: "object",
      properties: { assessmentNumber: { type: "string" } },
      required: ["assessmentNumber"],
    },
  },
  {
    name: "recovery_summary",
    description:
      "Aggregate RatesRecovery position: count and dollar value of candidates by severity, total estimated uplift and arrears.",
    input_schema: {
      type: "object",
      properties: {
        council: { type: "string", description: "Optional council code" },
      },
    },
  },
  {
    name: "daily_briefing",
    description: "Morning briefing for a rates officer: overdue, recovery candidates, action items.",
    input_schema: {
      type: "object",
      properties: {
        council: { type: "string" },
      },
    },
  },
  {
    name: "draft_payment_reminder",
    description:
      "Draft a personalised payment reminder for a property's owner. Returns the draft only — does not send.",
    input_schema: {
      type: "object",
      properties: {
        assessmentNumber: { type: "string" },
        tone: { type: "string", enum: ["friendly", "firm", "final"] },
      },
      required: ["assessmentNumber"],
    },
  },
  {
    name: "draft_chase_all_overdue",
    description:
      "Draft personalised reminders for all overdue properties not on a payment arrangement. Returns batch preview only — does not send.",
    input_schema: {
      type: "object",
      properties: {
        tone: { type: "string", enum: ["friendly", "firm", "final"] },
        council: { type: "string" },
      },
    },
  },
  {
    name: "verify_abn",
    description:
      "Verify an Australian Business Number via the ATO public ABN Lookup API. Returns entity name, status, type, GST registration.",
    input_schema: {
      type: "object",
      properties: { abn: { type: "string" } },
      required: ["abn"],
    },
  },
  {
    name: "fetch_dmirs_tenements",
    description:
      "Fetch live mining tenement data for a WA council from the public DMIRS / Landgate SLIP service. Returns count and summary.",
    input_schema: {
      type: "object",
      properties: { council: { type: "string" } },
      required: ["council"],
    },
  },
  {
    name: "list_councils",
    description: "List councils accessible in the current session.",
    input_schema: { type: "object", properties: {} },
  },
];

// ---------- Handlers ----------

const HANDLERS: Record<string, ToolHandler> = {
  async search_property({ query }) {
    const q = String(query ?? "");
    const results = searchProperties(q);
    if (!results.length) return `No properties matching "${q}".`;
    return [
      `Found ${results.length} match(es):`,
      ...results.map(
        (p) =>
          `- ${p.assessmentNumber} | ${p.address}, ${p.suburb} ${p.postcode} | ${p.landUse} | balance $${p.balance.toFixed(2)}`,
      ),
    ].join("\n");
  },

  async search_by_owner({ name, suburb }) {
    const results = searchByOwner(String(name ?? ""), suburb as string | undefined);
    if (!results.length) return `No properties found for owner matching "${name}".`;
    return [
      `Found ${results.length} property(ies):`,
      ...results.map((p) => {
        const owners = getOwnersForProperty(p).map((o) => o.name).join(", ");
        return `- ${p.assessmentNumber} | ${p.address}, ${p.suburb} | owner: ${owners} | balance $${p.balance.toFixed(2)}`;
      }),
    ].join("\n");
  },

  async get_property_detail({ assessmentNumber }) {
    const p = getProperty(String(assessmentNumber ?? ""));
    if (!p) return `No property ${assessmentNumber}.`;
    const owners = getOwnersForProperty(p);
    const tenements = getTenementsForAssessment(p.assessmentNumber);
    return [
      `**Assessment ${p.assessmentNumber}**`,
      `${p.address}, ${p.suburb} ${p.postcode} (${p.state})`,
      `Land use: ${p.landUse}`,
      `Valuation: $${p.valuation.toLocaleString()} · Annual rates: $${p.annualRates.toLocaleString()} · Balance: $${p.balance.toFixed(2)}`,
      p.lastPaymentDate
        ? `Last payment: ${p.lastPaymentDate} ($${p.lastPaymentAmount} via ${p.paymentMethod})`
        : "No payments on file",
      `Pensioner rebate: ${p.pensionerRebate ? "yes" : "no"} · Payment arrangement: ${p.paymentArrangement ? "yes" : "no"}`,
      ``,
      `**Owner(s):**`,
      ...owners.map(
        (o) =>
          `- ${o.name}${o.abn ? ` (ABN ${o.abn})` : ""} | ${o.phone ?? "no phone"} | ${o.email ?? "no email"}`,
      ),
      ``,
      tenements.length
        ? `**Intersecting tenements:**\n${tenements.map((t) => `- ${t.tenementId} (${t.status}, ${t.commodity.join(", ")}${t.isProducing ? ", producing" : ""})`).join("\n")}`
        : "No mining tenements intersect this parcel.",
      ``,
      p.notes.length ? `**Notes:**\n${p.notes.map((n) => `- ${n}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  },

  async get_transaction_history({ assessmentNumber }) {
    const txs = getTransactions(String(assessmentNumber ?? ""));
    if (!txs.length) return `No transactions on file for ${assessmentNumber}.`;
    return [
      `Transactions for ${assessmentNumber}:`,
      ...txs.map(
        (t) =>
          `- ${t.date} | ${t.type.padEnd(18)} | $${t.amount.toFixed(2).padStart(10)} | ${t.reference} | bal $${t.balance.toFixed(2)}`,
      ),
    ].join("\n");
  },

  async list_overdue({ council }) {
    const overdue = getOverdueProperties().filter((p) =>
      council ? p.council === council : true,
    );
    if (!overdue.length) return "No overdue properties.";
    const total = overdue.reduce((s, p) => s + p.balance, 0);
    return [
      `${overdue.length} overdue, total $${total.toLocaleString()}:`,
      ...overdue.map((p) => {
        const owners = getOwnersForProperty(p).map((o) => o.name).join(", ");
        return `- ${p.assessmentNumber} | ${p.address}, ${p.suburb} | ${owners} | $${p.balance.toFixed(2)}${p.paymentArrangement ? " (arrangement)" : ""}`;
      }),
    ].join("\n");
  },

  async find_mining_mismatches({ council, minSeverity }) {
    const candidates = findMismatches({
      council: council as string | undefined,
      minSeverity: minSeverity as "low" | "medium" | "high" | undefined,
    });
    if (!candidates.length) return "No mining-classification mismatches detected.";
    const total = candidates.reduce((s, c) => s + c.estUplift, 0);
    return [
      `**${candidates.length} candidate(s)** detected. Estimated total annual uplift: **$${total.toLocaleString()}**.`,
      ``,
      ...candidates.slice(0, 20).map((c, i) => {
        const tenList = c.tenements
          .map(
            (t) =>
              `${t.tenementId} (${t.status}, ${t.commodity.join("/")}${t.isProducing ? ", producing" : ""})`,
          )
          .join("; ");
        return [
          `${i + 1}. **${c.assessmentNumber}** — ${c.property.address}, ${c.property.suburb}`,
          `   Current: ${c.property.landUse} → Proposed: Mining (${c.severity}, ${(c.confidence * 100).toFixed(0)}% conf.)`,
          `   Tenements: ${tenList}`,
          `   Est. annual uplift: **$${c.estUplift.toLocaleString()}** (current $${c.property.annualRates.toLocaleString()} → proposed $${c.estAnnualRatesNew.toLocaleString()})`,
          `   Est. arrears (3y): $${c.estArrears5y.toLocaleString()}`,
        ].join("\n");
      }),
      ``,
      `Use generate_evidence_pack with an assessment number to produce a council-grade reclassification case file.`,
    ].join("\n");
  },

  async generate_evidence_pack({ assessmentNumber }) {
    const pack = buildEvidencePack(String(assessmentNumber ?? ""));
    if (!pack)
      return `No evidence pack generated for ${assessmentNumber}: either property not found or no mismatch detected.`;
    return pack.markdown;
  },

  async recovery_summary({ council }) {
    const stats = recoveryStats(council as string | undefined);
    return [
      `**Recovery summary${council ? ` (${council})` : " (all councils)"}**`,
      ``,
      `- Candidates: **${stats.total}** (${stats.high} high · ${stats.medium} medium · ${stats.low} low)`,
      `- Estimated annual uplift: **$${stats.totalUplift.toLocaleString()}**`,
      `- Estimated 3-year arrears: **$${stats.totalArrears.toLocaleString()}**`,
      `- Estimated total recovery: **$${stats.totalRecovery.toLocaleString()}**`,
      `- High-severity uplift only: **$${stats.highUplift.toLocaleString()}**`,
    ].join("\n");
  },

  async daily_briefing({ council }) {
    const overdue = getOverdueProperties().filter((p) =>
      council ? p.council === council : true,
    );
    const totalOverdue = overdue.reduce((s, p) => s + p.balance, 0);
    const arrangements = overdue.filter((p) => p.paymentArrangement).length;
    const stats = recoveryStats(council as string | undefined);

    return [
      `**Rates briefing — ${new Date().toISOString().slice(0, 10)}${council ? ` · ${council}` : ""}**`,
      ``,
      `_Productivity_`,
      `- Overdue accounts: ${overdue.length} (total $${totalOverdue.toLocaleString()})`,
      `- On payment arrangements: ${arrangements}`,
      `- Need follow-up: ${overdue.length - arrangements}`,
      ``,
      `_Recovery (RatesRecovery)_`,
      `- Open candidates: ${stats.total} (${stats.high} high)`,
      `- Estimated annual uplift: $${stats.totalUplift.toLocaleString()}`,
      ``,
      `_Top 3 overdue by balance_`,
      ...overdue
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 3)
        .map((p) => `- ${p.address}, ${p.suburb} — $${p.balance.toFixed(2)}`),
    ].join("\n");
  },

  async draft_payment_reminder({ assessmentNumber, tone = "friendly" }) {
    const p = getProperty(String(assessmentNumber ?? ""));
    if (!p) return `No property ${assessmentNumber}.`;
    if (p.balance <= 0) return `${assessmentNumber} has no outstanding balance.`;
    const owner = getOwnersForProperty(p)[0];
    const greeting = tone === "final" ? "Notice" : `Hi ${owner.name.split(" ")[0]}`;
    const body =
      tone === "friendly"
        ? `friendly reminder that council rates of $${p.balance.toFixed(2)} for ${p.address} are now overdue. You can pay via BPAY, online, or call our office.`
        : tone === "firm"
          ? `your council rates of $${p.balance.toFixed(2)} for ${p.address} remain unpaid. Please arrange payment within 7 days to avoid further action.`
          : `final notice — rates of $${p.balance.toFixed(2)} for ${p.address} are significantly overdue. Legal recovery may commence. Contact us immediately on (council number).`;
    return [
      `Draft (${tone}) for ${owner.name} (${owner.phone ?? "no phone"}):`,
      ``,
      `${greeting}, ${body}`,
      ``,
      `[NOT SENT — confirmation required]`,
    ].join("\n");
  },

  async draft_chase_all_overdue({ tone = "friendly", council }) {
    const overdue = getOverdueProperties()
      .filter((p) => !p.paymentArrangement)
      .filter((p) => (council ? p.council === council : true));
    if (!overdue.length) return "Nothing to chase.";
    return [
      `Would send ${overdue.length} ${tone} reminders:`,
      ...overdue.map((p) => {
        const owner = getOwnersForProperty(p)[0];
        return `→ ${owner.name} (${owner.phone ?? "no phone"}) — ${p.address} — $${p.balance.toFixed(2)}`;
      }),
      ``,
      `[NOT SENT — say "send all" to confirm]`,
    ].join("\n");
  },

  async verify_abn({ abn }) {
    const result = await lookupAbn(String(abn ?? ""));
    if (!result.ok) return `ABN lookup failed: ${result.error}`;
    return [
      `**ABN ${result.abn}**`,
      `Entity: ${result.entityName}`,
      `Type: ${result.entityType ?? "unknown"}`,
      `Status: ${result.status}`,
      `GST registered: ${result.gstRegistered ? "yes" : "no"}${result.gstRegisteredFrom ? ` (since ${result.gstRegisteredFrom})` : ""}`,
      result.address ? `Address: ${result.address}` : "",
      result.source ? `Source: ${result.source}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  },

  async fetch_dmirs_tenements({ council }) {
    const result = await fetchDmirsTenementsForCouncil(String(council ?? ""));
    if (!result.ok) return `DMIRS fetch failed: ${result.error}`;
    return [
      `Fetched **${result.count}** tenement(s) intersecting ${council} (source: ${result.source}).`,
      result.sample.length
        ? "\nSample:\n" +
          result.sample
            .map((t) => `- ${t.tenementId} (${t.status}, ${t.commodity.join("/")})`)
            .join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  },

  async list_councils() {
    return [
      `**${COUNCILS.length} council(s) accessible:**`,
      ...COUNCILS.map(
        (c) =>
          `- ${c.code} · ${c.name} (${c.state}) — ${c.population.toLocaleString()} pop., ${c.rateableProperties.toLocaleString()} properties, $${(c.rateRevenue / 1_000_000).toFixed(1)}M annual rate revenue`,
      ),
    ].join("\n");
  },
};

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ output: string; durationMs: number; error?: string }> {
  const start = Date.now();
  const handler = HANDLERS[name];
  if (!handler) {
    return {
      output: `Unknown tool: ${name}`,
      durationMs: Date.now() - start,
      error: "unknown_tool",
    };
  }
  try {
    const output = await handler(input);
    return { output, durationMs: Date.now() - start };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      output: `Tool error: ${message}`,
      durationMs: Date.now() - start,
      error: message,
    };
  }
}
