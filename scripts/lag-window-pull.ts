/**
 * scripts/lag-window-pull.ts — DMIRS-ahead-of-Landgate CLI poller.
 *
 * Pulls live DMIRS grants × DPIRD landuse, joins them, and emits a markdown
 * report at reports/<lga>-lag-window-<date>.md. Falls back to the seeded
 * grant + parcel set with a clear note if either upstream is unreachable.
 *
 * Usage:
 *   npm run lag-window -- --lga "Karratha" --since 90
 *   npm run lag-window -- --since 30 --min-severity high
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findLagWindowCandidates,
  SEEDED_GRANTS,
  SEEDED_LAGWINDOW_PARCELS,
  type LagCandidate,
} from "@ratesassist/spatial";

type Args = {
  lga?: string;
  sinceDays: number;
  minSeverity: "high" | "medium" | "low";
  outDir: string;
};

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { sinceDays: 90, minSeverity: "medium", outDir: "reports" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--lga": out.lga = next(); break;
      case "--since": out.sinceDays = Number(next()); break;
      case "--min-severity": {
        const v = next().toLowerCase();
        if (v !== "high" && v !== "medium" && v !== "low") {
          throw new Error("--min-severity must be high|medium|low");
        }
        out.minSeverity = v;
        break;
      }
      case "--out": out.outDir = next(); break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!Number.isFinite(out.sinceDays) || out.sinceDays < 1 || out.sinceDays > 365) {
    throw new Error("--since must be 1..365");
  }
  return out;
}

function printHelp(): void {
  console.log(`Usage: npm run lag-window -- [options]

Options:
  --lga <name>           LGA name hint (cosmetic; used in report title)
  --since <days>         Lookback window in days (1..365, default 90)
  --min-severity <sev>   high|medium|low (default medium)
  --out <dir>            Output directory (default ./reports)
  -h, --help             Show this help.
`);
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 } as const;

// Conservative pre-scoring uplift estimates per severity hint (AUD/year).
// Calibrated against pilot-1 Pilbara councils — the same calibration as
// UPLIFT_MULTIPLIER in the recovery engine, applied here to a placeholder
// $5,000 base annual rate per affected parcel.
const PLACEHOLDER_BASE_RATES = 5_000;
const UPLIFT_MULTIPLIER = { high: 8, medium: 4, low: 1.5 } as const;

function estimateUpliftAud(severity: "high" | "medium" | "low"): number {
  return (UPLIFT_MULTIPLIER[severity] - 1) * PLACEHOLDER_BASE_RATES;
}

function fmtAud(n: number): string {
  return `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
}

function buildReportMarkdown(args: {
  candidates: readonly LagCandidate[];
  source: "live" | "seeded" | "cache";
  note?: string;
  generatedAt: Date;
  cli: Args;
}): string {
  const { candidates, source, note, generatedAt, cli } = args;
  const total = candidates.length;
  const totalUplift = candidates.reduce(
    (s, c) => s + estimateUpliftAud(c.severityHint),
    0,
  );
  const byHint = {
    high: candidates.filter((c) => c.severityHint === "high").length,
    medium: candidates.filter((c) => c.severityHint === "medium").length,
    low: candidates.filter((c) => c.severityHint === "low").length,
  };

  const lines: string[] = [];
  lines.push(`# Cadastre-lag report — ${cli.lga ?? "WA (all LGAs)"}`);
  lines.push("");
  lines.push(`Generated: ${generatedAt.toISOString()}`);
  lines.push(`Source: \`${source}\`${note ? `  \nNote: ${note}` : ""}`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");
  lines.push(`- **${total}** cadastre-lag candidates (${byHint.high} high / ${byHint.medium} medium / ${byHint.low} low)`);
  lines.push(`- Lookback: last **${cli.sinceDays} days**`);
  lines.push(`- Minimum severity surfaced: **${cli.minSeverity}**`);
  lines.push(
    `- Indicative total annual uplift if all reclassified: **${fmtAud(totalUplift)}**`,
  );
  lines.push("");
  lines.push("> Uplift uses the recovery engine's `UPLIFT_MULTIPLIER` against a $5,000 placeholder base. Production runs apply each parcel's actual annual rates.");
  lines.push("");
  lines.push("## Candidates");
  lines.push("");
  lines.push(
    "| # | Severity | Tenement | Type | Granted | Parcel landuse | Lag (days) | Est. uplift | MINEDEX | Landgate |",
  );
  lines.push(
    "|--:|:--------:|:---------|:-----|:--------|:---------------|----------:|------------:|:--------|:---------|",
  );
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    lines.push(
      `| ${i + 1} | ${c.severityHint.toUpperCase()} | ${c.tenement.tenementIdDisplay} | ${c.tenement.typeLabel} | ${c.tenement.grantDate} | ${c.parcel.landuse} | ${c.lagDays} | ${fmtAud(estimateUpliftAud(c.severityHint))} | [MINEDEX](${c.tenement.detailUrl}) | [Landgate](${c.parcel.detailUrl}) |`,
    );
  }
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push("1. Pull recently-granted live tenements from DMIRS MINEDEX via SLIP Industry_and_Mining/MapServer/3.");
  lines.push("2. Pull WA landuse polygons from DPIRD's Generalised Agricultural Land Use layer (SLIP Farming/MapServer/7). DPIRD is the public proxy for Landgate's parcel-scale landuse classification; the SLIP Property_and_Planning/MapServer/2 cadastre is `(No Attributes)` on the public tier.");
  lines.push("3. Bbox-intersect every (tenement, parcel) pair. Suppress where parcel landuse is already mining, crown, or conservation.");
  lines.push("4. Severity hint: M-class on residential/rural = HIGH; M on vacant or G/L on rural/vacant = MEDIUM; everything else surfaced = LOW (officer review).");
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  lines.push("- DPIRD landuse refreshes approximately twice yearly; lag values may include both true reclassification lag and DPIRD refresh cadence. The signal is conservative — false positives are surfaced for officer review, not auto-actioned.");
  lines.push("- Bbox intersection is a strict superset of polygon intersection; a real PostGIS join replaces it in Phase 2.");
  lines.push("- Pastoral and Crown leases are excluded — councils have no general-rate reclassification basis on those tenures.");
  lines.push("- Uplift figures assume a $5,000 placeholder base annual rate. Wire each parcel's actual annual rates for production reporting.");
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date();

  console.log(
    `[lag-window] sinceDays=${args.sinceDays} minSeverity=${args.minSeverity}${args.lga ? ` lga=${args.lga}` : ""}`,
  );

  const result = await findLagWindowCandidates({
    sinceDays: args.sinceDays,
    seededGrants: SEEDED_GRANTS,
    seededParcels: SEEDED_LAGWINDOW_PARCELS,
  });

  if (!result.ok) {
    console.error(`[lag-window] FAILED: ${result.code} — ${result.error}`);
    process.exit(1);
  }

  const minRank = SEVERITY_RANK[args.minSeverity];
  const candidates = result.candidates.filter(
    (c) => SEVERITY_RANK[c.severityHint] >= minRank,
  );

  console.log(
    `[lag-window] source=${result.source} candidates=${candidates.length}${result.note ? ` note="${result.note}"` : ""}`,
  );

  const outDir = resolve(process.cwd(), args.outDir);
  mkdirSync(outDir, { recursive: true });
  const dateStamp = generatedAt.toISOString().slice(0, 10);
  const lgaSlug = (args.lga ?? "wa-all").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const file = resolve(outDir, `${lgaSlug}-lag-window-${dateStamp}.md`);

  const md = buildReportMarkdown({
    candidates,
    source: result.source,
    ...(result.note !== undefined ? { note: result.note } : {}),
    generatedAt,
    cli: args,
  });
  writeFileSync(file, md, "utf8");
  console.log(`[lag-window] wrote ${file}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
