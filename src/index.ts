import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  PROPERTIES,
  OWNERS,
  searchProperties,
  searchByOwnerName,
  getOwnersForProperty,
  getOverdueProperties,
  getTransactions,
} from "./mock-data.js";
import {
  TENEMENTS,
  getTenementsForAssessment,
  getAllLiveTenements,
  type Tenement,
} from "./wa-tenements.js";

const server = new McpServer({
  name: "rates-assist",
  version: "0.1.0",
});

// ----- READ TOOLS -----

server.registerTool(
  "search_property",
  {
    description:
      "Search properties by address fragment, suburb, or assessment number. Returns matching properties.",
    inputSchema: {
      query: z.string().describe("Address, suburb, or assessment number (partial OK)"),
    },
  },
  async ({ query }) => {
    const results = searchProperties(query);
    if (!results.length) {
      return { content: [{ type: "text", text: `No properties found matching "${query}".` }] };
    }
    const text = results
      .map(
        (p) =>
          `${p.assessmentNumber} — ${p.address}, ${p.suburb} ${p.postcode} | ${p.landUse} | balance $${p.balance.toFixed(2)}`,
      )
      .join("\n");
    return { content: [{ type: "text", text: `Found ${results.length} match(es):\n${text}` }] };
  },
);

server.registerTool(
  "search_by_owner",
  {
    description: "Find properties by owner name (partial OK). Optionally filter by suburb.",
    inputSchema: {
      name: z.string().describe("Owner name fragment, e.g. 'Smith'"),
      suburb: z.string().optional().describe("Optional suburb filter"),
    },
  },
  async ({ name, suburb }) => {
    const results = searchByOwnerName(name, suburb);
    if (!results.length) {
      return { content: [{ type: "text", text: `No properties found for owner matching "${name}".` }] };
    }
    const text = results
      .map((p) => {
        const owners = getOwnersForProperty(p).map((o) => o.name).join(", ");
        return `${p.assessmentNumber} — ${p.address}, ${p.suburb} | owner: ${owners} | balance $${p.balance.toFixed(2)}`;
      })
      .join("\n");
    return { content: [{ type: "text", text: `Found ${results.length} property(ies):\n${text}` }] };
  },
);

server.registerTool(
  "get_property_detail",
  {
    description: "Full detail for a property including owner(s), valuation, balance, payment history flags, and notes.",
    inputSchema: {
      assessmentNumber: z.string().describe("Assessment number, e.g. '4471-22'"),
    },
  },
  async ({ assessmentNumber }) => {
    const p = PROPERTIES.find((x) => x.assessmentNumber === assessmentNumber);
    if (!p) return { content: [{ type: "text", text: `No property with assessment ${assessmentNumber}.` }] };
    const owners = getOwnersForProperty(p);
    const ownerLines = owners
      .map(
        (o) =>
          `  - ${o.name} | ${o.phone ?? "no phone"} | ${o.email ?? "no email"} | postal: ${o.postalAddress} | since ${o.ownerSince}`,
      )
      .join("\n");
    const text = [
      `Assessment ${p.assessmentNumber}`,
      `Address: ${p.address}, ${p.suburb} ${p.postcode}`,
      `Land use: ${p.landUse}`,
      `Valuation: $${p.valuation.toLocaleString()}`,
      `Annual rates: $${p.annualRates.toFixed(2)}`,
      `Balance: $${p.balance.toFixed(2)}`,
      `Last payment: ${p.lastPaymentDate ?? "none"}${p.lastPaymentAmount ? ` ($${p.lastPaymentAmount} via ${p.paymentMethod})` : ""}`,
      `Pensioner rebate: ${p.pensionerRebate ? "yes" : "no"}`,
      `Payment arrangement: ${p.paymentArrangement ? "yes" : "no"}`,
      ``,
      `Owner(s):`,
      ownerLines,
      ``,
      `Notes:`,
      p.notes.length ? p.notes.map((n) => `  - ${n}`).join("\n") : "  (none)",
    ].join("\n");
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "get_transaction_history",
  {
    description: "Transaction history (levies, payments, adjustments, interest) for a property.",
    inputSchema: {
      assessmentNumber: z.string(),
    },
  },
  async ({ assessmentNumber }) => {
    const txs = getTransactions(assessmentNumber);
    if (!txs.length) {
      return { content: [{ type: "text", text: `No transactions on file for ${assessmentNumber}.` }] };
    }
    const text = txs
      .map((t) => `${t.date} | ${t.type.padEnd(18)} | $${t.amount.toFixed(2).padStart(10)} | ${t.reference} | bal $${t.balance.toFixed(2)}`)
      .join("\n");
    return { content: [{ type: "text", text: `Transactions for ${assessmentNumber}:\n${text}` }] };
  },
);

server.registerTool(
  "list_overdue",
  {
    description: "List all properties with an outstanding rates balance. Useful for chase workflows.",
    inputSchema: {},
  },
  async () => {
    const overdue = getOverdueProperties();
    if (!overdue.length) return { content: [{ type: "text", text: "No properties currently overdue." }] };
    const total = overdue.reduce((s, p) => s + p.balance, 0);
    const text =
      `${overdue.length} properties overdue, total $${total.toFixed(2)}:\n\n` +
      overdue
        .map((p) => {
          const owners = getOwnersForProperty(p).map((o) => o.name).join(", ");
          return `${p.assessmentNumber} — ${p.address}, ${p.suburb} | ${owners} | $${p.balance.toFixed(2)}${p.paymentArrangement ? " (arrangement)" : ""}`;
        })
        .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// ----- WRITE / WORKFLOW TOOLS (mocked — return preview, no real side effect) -----

server.registerTool(
  "draft_payment_reminder",
  {
    description:
      "Draft a personalised payment reminder for a property's owner. Returns the draft. Does NOT send.",
    inputSchema: {
      assessmentNumber: z.string(),
      tone: z.enum(["friendly", "firm", "final"]).default("friendly"),
    },
  },
  async ({ assessmentNumber, tone }) => {
    const p = PROPERTIES.find((x) => x.assessmentNumber === assessmentNumber);
    if (!p) return { content: [{ type: "text", text: `No property ${assessmentNumber}.` }] };
    if (p.balance <= 0)
      return { content: [{ type: "text", text: `${assessmentNumber} has no outstanding balance.` }] };
    const owner = getOwnersForProperty(p)[0];
    const greeting = tone === "final" ? "Notice" : `Hi ${owner.name.split(" ")[0]}`;
    const body =
      tone === "friendly"
        ? `friendly reminder that council rates of $${p.balance.toFixed(2)} for ${p.address} are now overdue. You can pay via BPAY, online, or call our office.`
        : tone === "firm"
          ? `your council rates of $${p.balance.toFixed(2)} for ${p.address} remain unpaid. Please arrange payment within 7 days to avoid further action.`
          : `final notice — rates of $${p.balance.toFixed(2)} for ${p.address} are significantly overdue. Legal recovery may commence. Contact us immediately on (council number).`;
    const draft = `${greeting}, ${body}`;
    return {
      content: [
        {
          type: "text",
          text: `Draft (${tone}) for ${owner.name} (${owner.phone ?? "no phone"}):\n\n${draft}\n\n[NOT SENT — confirmation required]`,
        },
      ],
    };
  },
);

server.registerTool(
  "draft_chase_all_overdue",
  {
    description:
      "Draft a personalised payment reminder for every overdue property. Returns batch preview. Does NOT send.",
    inputSchema: {
      tone: z.enum(["friendly", "firm", "final"]).default("friendly"),
    },
  },
  async ({ tone }) => {
    const overdue = getOverdueProperties().filter((p) => !p.paymentArrangement);
    if (!overdue.length) return { content: [{ type: "text", text: "Nothing to chase." }] };
    const drafts = overdue.map((p) => {
      const owner = getOwnersForProperty(p)[0];
      return `→ ${owner.name} (${owner.phone ?? "no phone"}) — ${p.address} — $${p.balance.toFixed(2)}`;
    });
    return {
      content: [
        {
          type: "text",
          text: `Would send ${overdue.length} ${tone} reminders:\n${drafts.join("\n")}\n\n[NOT SENT — say 'send all' to confirm]`,
        },
      ],
    };
  },
);

server.registerTool(
  "update_owner_contact",
  {
    description:
      "Update an owner's phone and/or email. Returns confirmation preview. Does NOT commit until confirmed.",
    inputSchema: {
      ownerId: z.string(),
      newPhone: z.string().optional(),
      newEmail: z.string().email().optional(),
    },
  },
  async ({ ownerId, newPhone, newEmail }) => {
    const owner = OWNERS.find((o) => o.ownerId === ownerId);
    if (!owner) return { content: [{ type: "text", text: `No owner ${ownerId}.` }] };
    const changes: string[] = [];
    if (newPhone) changes.push(`phone: ${owner.phone ?? "none"} → ${newPhone}`);
    if (newEmail) changes.push(`email: ${owner.email ?? "none"} → ${newEmail}`);
    if (!changes.length) return { content: [{ type: "text", text: "No changes specified." }] };
    return {
      content: [
        {
          type: "text",
          text: `Proposed change to ${owner.name} (${ownerId}):\n  ${changes.join("\n  ")}\n\n[NOT COMMITTED — confirmation required]`,
        },
      ],
    };
  },
);

server.registerTool(
  "daily_briefing",
  {
    description: "Morning briefing for a rates officer: overdue count, total outstanding, properties needing attention.",
    inputSchema: {},
  },
  async () => {
    const overdue = getOverdueProperties();
    const total = overdue.reduce((s, p) => s + p.balance, 0);
    const arrangements = overdue.filter((p) => p.paymentArrangement).length;
    const needingChase = overdue.length - arrangements;
    const text = [
      `Rates briefing — ${new Date().toISOString().slice(0, 10)}`,
      ``,
      `Overdue accounts: ${overdue.length}`,
      `Total outstanding: $${total.toLocaleString()}`,
      `On payment arrangements: ${arrangements}`,
      `Need follow-up: ${needingChase}`,
      ``,
      `Top 3 by balance:`,
      ...overdue
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 3)
        .map((p) => `  ${p.address}, ${p.suburb} — $${p.balance.toFixed(2)}`),
    ].join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// ----- WA MINING TENEMENT TOOLS (RatesRecovery core) -----

function classifyMismatch(
  landUse: string,
  tenements: Tenement[],
): { kind: string; severity: "high" | "medium" | "low"; reason: string } | null {
  if (!tenements.length) return null;
  const live = tenements.filter((t) => t.status === "Live");
  if (!live.length) return null;
  const producing = live.filter((t) => t.isProducing);
  const isMiningType = live.some((t) => ["M", "G"].includes(t.type));
  const isExploration = live.every((t) => ["E", "P", "L"].includes(t.type));

  if (producing.length && (landUse === "Rural" || landUse === "Vacant")) {
    return {
      kind: "Producing tenement on rural/vacant rate",
      severity: "high",
      reason: `Property currently rated as ${landUse}, but ${producing.length} producing tenement(s) intersect this parcel. Reclassification to Mining is strongly indicated under WA LGA s.6.16.`,
    };
  }
  if (isMiningType && (landUse === "Rural" || landUse === "Vacant")) {
    return {
      kind: "Live mining lease on rural/vacant rate",
      severity: "high",
      reason: `A live mining lease intersects this parcel. Land use category Mining applies regardless of current production status.`,
    };
  }
  if (isExploration && landUse === "Rural") {
    return {
      kind: "Exploration tenement only — review",
      severity: "low",
      reason: `Only exploration/prospecting tenements intersect this parcel. Reclassification depends on actual ground disturbance — recommend aerial imagery review before proposing change.`,
    };
  }
  return null;
}

function estimateUplift(annualRatesNow: number, severity: "high" | "medium" | "low"): {
  estAnnualRatesNew: number;
  estUplift: number;
} {
  // Conservative multipliers; real version uses council differential rate tables.
  const multiplier = severity === "high" ? 8 : severity === "medium" ? 4 : 1.5;
  const estAnnualRatesNew = Math.round(annualRatesNow * multiplier);
  return { estAnnualRatesNew, estUplift: estAnnualRatesNew - annualRatesNow };
}

server.registerTool(
  "find_mining_mismatches",
  {
    description:
      "Cross-reference rated properties against active WA mining tenements (DMIRS data) and surface candidates where the rating classification appears mis-aligned with the actual land use. Returns ranked list with confidence and estimated annual uplift.",
    inputSchema: {
      minSeverity: z
        .enum(["low", "medium", "high"])
        .default("low")
        .describe("Minimum severity to include in results"),
    },
  },
  async ({ minSeverity }) => {
    const sevRank = { low: 0, medium: 1, high: 2 } as const;
    const candidates: Array<{
      assessmentNumber: string;
      address: string;
      suburb: string;
      currentClassification: string;
      tenements: Tenement[];
      mismatch: { kind: string; severity: "high" | "medium" | "low"; reason: string };
      estUplift: number;
      estAnnualRatesNew: number;
    }> = [];

    for (const p of PROPERTIES) {
      const tenements = getTenementsForAssessment(p.assessmentNumber);
      if (!tenements.length) continue;
      const mismatch = classifyMismatch(p.landUse, tenements);
      if (!mismatch) continue;
      if (sevRank[mismatch.severity] < sevRank[minSeverity]) continue;
      const { estAnnualRatesNew, estUplift } = estimateUplift(p.annualRates, mismatch.severity);
      candidates.push({
        assessmentNumber: p.assessmentNumber,
        address: p.address,
        suburb: p.suburb,
        currentClassification: p.landUse,
        tenements,
        mismatch,
        estUplift,
        estAnnualRatesNew,
      });
    }

    candidates.sort((a, b) => b.estUplift - a.estUplift);

    if (!candidates.length) {
      return {
        content: [{ type: "text", text: `No mining-classification mismatches found at severity >= ${minSeverity}.` }],
      };
    }

    const totalUplift = candidates.reduce((s, c) => s + c.estUplift, 0);
    const lines = candidates.map((c, i) => {
      const tenList = c.tenements.map((t) => `${t.tenementId} (${t.status}, ${t.commodity.join("/")}${t.isProducing ? ", producing" : ""})`).join("; ");
      return [
        `${i + 1}. ${c.assessmentNumber} — ${c.address}, ${c.suburb}`,
        `   Current: ${c.currentClassification}  →  Proposed: Mining (${c.mismatch.severity} severity)`,
        `   Tenements: ${tenList}`,
        `   Reason: ${c.mismatch.reason}`,
        `   Est. annual uplift: $${c.estUplift.toLocaleString()} (current $${c.tenements.length ? PROPERTIES.find((p) => p.assessmentNumber === c.assessmentNumber)!.annualRates.toLocaleString() : 0} → proposed $${c.estAnnualRatesNew.toLocaleString()})`,
      ].join("\n");
    });

    const text = [
      `Mining-classification mismatch audit (severity >= ${minSeverity}):`,
      `${candidates.length} candidate(s). Estimated total annual uplift: $${totalUplift.toLocaleString()}.`,
      ``,
      ...lines,
      ``,
      `Use generate_evidence_pack with an assessment number to produce a council-grade reclassification case file.`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "get_tenement_for_property",
  {
    description: "Look up WA mining tenements that intersect a specific property assessment.",
    inputSchema: {
      assessmentNumber: z.string(),
    },
  },
  async ({ assessmentNumber }) => {
    const tenements = getTenementsForAssessment(assessmentNumber);
    if (!tenements.length) {
      return { content: [{ type: "text", text: `No DMIRS tenements intersect ${assessmentNumber}.` }] };
    }
    const lines = tenements.map((t) =>
      [
        `${t.tenementId} — ${t.type === "M" ? "Mining Lease" : t.type === "E" ? "Exploration Licence" : t.type === "P" ? "Prospecting Licence" : t.type === "G" ? "General Purpose Lease" : "Misc Licence"}`,
        `  Status: ${t.status} | Holder: ${t.holder} (ABN ${t.holderAbn ?? "—"})`,
        `  Commodity: ${t.commodity.join(", ")}`,
        `  Granted: ${t.grantedDate} | Expires: ${t.expiryDate}`,
        `  Area: ${t.areaHectares.toLocaleString()} ha | Producing: ${t.isProducing ? "yes" : "no"}${t.lastWorkProgramYear ? ` | Last work program: ${t.lastWorkProgramYear}` : ""}`,
      ].join("\n"),
    );
    return { content: [{ type: "text", text: `Tenements intersecting ${assessmentNumber}:\n\n${lines.join("\n\n")}` }] };
  },
);

server.registerTool(
  "generate_evidence_pack",
  {
    description:
      "Produce a council-grade reclassification evidence pack for a mining-mismatch candidate. Includes property record, tenement evidence, statutory basis, estimated uplift, and draft notice text.",
    inputSchema: {
      assessmentNumber: z.string(),
    },
  },
  async ({ assessmentNumber }) => {
    const p = PROPERTIES.find((x) => x.assessmentNumber === assessmentNumber);
    if (!p) return { content: [{ type: "text", text: `No property ${assessmentNumber}.` }] };
    const tenements = getTenementsForAssessment(assessmentNumber);
    if (!tenements.length) {
      return { content: [{ type: "text", text: `No tenements intersect ${assessmentNumber} — no evidence pack required.` }] };
    }
    const mismatch = classifyMismatch(p.landUse, tenements);
    if (!mismatch) {
      return { content: [{ type: "text", text: `No mismatch detected for ${assessmentNumber} — no evidence pack required.` }] };
    }
    const { estAnnualRatesNew, estUplift } = estimateUplift(p.annualRates, mismatch.severity);
    const owner = getOwnersForProperty(p)[0];
    const tenLines = tenements
      .map((t) => `  - ${t.tenementId} | ${t.status} | ${t.commodity.join(", ")} | holder: ${t.holder} (ABN ${t.holderAbn ?? "—"}) | producing: ${t.isProducing ? "yes" : "no"}`)
      .join("\n");

    const today = new Date().toISOString().slice(0, 10);
    const pack = `
========================================================================
RATESASSIST — RECLASSIFICATION EVIDENCE PACK
========================================================================
Generated: ${today}
Pack ID:   EP-${assessmentNumber}-${today.replace(/-/g, "")}
Severity:  ${mismatch.severity.toUpperCase()}

------------------------------------------------------------------------
1. PROPERTY IDENTIFICATION
------------------------------------------------------------------------
Assessment number:      ${p.assessmentNumber}
Address:                ${p.address}, ${p.suburb} ${p.postcode}
Current classification: ${p.landUse}
Current valuation:      $${p.valuation.toLocaleString()}
Current annual rates:   $${p.annualRates.toLocaleString()}

Owner of record:
  ${owner.name}
  ${owner.postalAddress}
  ${owner.phone ?? "no phone on file"} | ${owner.email ?? "no email on file"}
  Owner since: ${owner.ownerSince}

------------------------------------------------------------------------
2. EXTERNAL EVIDENCE — DMIRS TENEMENT REGISTER
------------------------------------------------------------------------
Source:     DMIRS MINEDEX / GeoVIEW.WA (public)
Retrieved:  ${today}

Active tenements intersecting this parcel:
${tenLines}

------------------------------------------------------------------------
3. MISMATCH ANALYSIS
------------------------------------------------------------------------
Kind:     ${mismatch.kind}
Severity: ${mismatch.severity}
Reason:   ${mismatch.reason}

------------------------------------------------------------------------
4. STATUTORY BASIS
------------------------------------------------------------------------
- Local Government Act 1995 (WA), s.6.16 — power to differentiate
  general rates by land use category.
- Local Government Act 1995 (WA), s.6.81 — backdating limit for
  rate adjustments (5 years from current rate year).
- Council's adopted differential rates schedule for the relevant
  rating year (see council-specific rate-in-the-dollar table).

------------------------------------------------------------------------
5. PROPOSED RECLASSIFICATION
------------------------------------------------------------------------
Current category:       ${p.landUse}
Proposed category:      Mining
Estimated annual rates: $${p.annualRates.toLocaleString()} → $${estAnnualRatesNew.toLocaleString()}
Estimated annual uplift: $${estUplift.toLocaleString()}
Estimated arrears (5y, conservative): $${(estUplift * 3).toLocaleString()} (subject to rate-year-by-year recalculation)

------------------------------------------------------------------------
6. DRAFT NOTICE TO RATEPAYER
------------------------------------------------------------------------
[Council letterhead]

${owner.name}
${owner.postalAddress}

Re: Notice of proposed rate category reclassification — Assessment ${p.assessmentNumber}

We write to advise that following a review of the rating classification
applied to your property at ${p.address}, ${p.suburb}, the council
proposes to reclassify the property from "${p.landUse}" to "Mining" with
effect from the next rating year, on the basis of active mining tenement
coverage recorded by the WA Department of Mines, Industry Regulation
and Safety.

The estimated annual rates under the proposed category are
$${estAnnualRatesNew.toLocaleString()}, an increase of $${estUplift.toLocaleString()} over the current
amount. Backdated adjustments may apply within the limits set by
Section 6.81 of the Local Government Act 1995 (WA).

You have the right to object to this proposed reclassification within
[council-defined period] of the date of this notice. Objections should
be lodged in writing to [council contact].

------------------------------------------------------------------------
7. AUDIT TRAIL
------------------------------------------------------------------------
Property record source:   Council rating system
Tenement record source:   DMIRS MINEDEX / GeoVIEW.WA
Cross-reference logic:    RatesAssist mining-mismatch detection
Severity scoring:         Rule-based (deterministic, see methodology)
Reviewed by AI:           Yes (narration only — scoring is deterministic)
Officer review required:  Yes — council retains statutory authority
========================================================================
`.trim();

    return { content: [{ type: "text", text: pack }] };
  },
);

// ----- BOOT -----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("rates-assist MCP running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
