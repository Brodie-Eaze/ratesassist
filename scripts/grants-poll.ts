/**
 * scripts/grants-poll.ts — newly-granted live tenement poller (CLI).
 *
 * Hits the live SLIP DMIRS-003 layer for grants since `--since` days ago,
 * optionally filtered by LGA bbox. Prints a console table. Used for ops +
 * demo. No daemon — run via cron (06:00 AWST) once Phase 2 lands the
 * watermark store.
 *
 * Usage:
 *   npm run grants-poll -- --lga "Karratha" --since 7
 *   npm run grants-poll -- --since 30 --types M,G,L
 *
 * Falls back to seeded fixtures with a clear note if SLIP is unreachable.
 */

import {
  fetchRecentlyGrantedTenements,
  SEEDED_GRANTS,
} from "@ratesassist/spatial";

type Args = {
  lga?: string;
  sinceDays: number;
  types?: string[];
};

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { sinceDays: 30 };
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
      case "--types": out.types = next().split(",").map((s) => s.trim()); break;
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
  console.log(`Usage: npm run grants-poll -- [options]

Options:
  --lga <name>       LGA name hint (cosmetic; bbox filter not yet wired here)
  --since <days>     Lookback window in days (1..365, default 30)
  --types <csv>      Type-code allow-list, e.g. "M,G,L"
  -h, --help         Print this help
`);
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    printHelp();
    return 2;
  }

  const sinceMs = Date.now() - args.sinceDays * 86_400_000;
  console.log(
    `[grants-poll] lga="${args.lga ?? "(all WA)"}" sinceDays=${args.sinceDays} types=${args.types?.join(",") ?? "(all)"}`,
  );

  const result = await fetchRecentlyGrantedTenements({
    sinceMs,
    ...(args.types !== undefined ? { types: args.types } : {}),
    seededFeatures: SEEDED_GRANTS,
  });

  if (!result.ok) {
    console.error(`[grants-poll] FAIL: ${result.code}: ${result.error}`);
    return 1;
  }

  console.log(`[grants-poll] source=${result.source} grants=${result.grants.length}`);
  if (result.note !== undefined) console.log(`[grants-poll] note: ${result.note}`);
  console.log(``);

  if (result.grants.length === 0) {
    console.log(`(no grants in the period)`);
    return 0;
  }

  // Console table — keep columns short and predictable.
  const rows = result.grants.map((g) => ({
    Tenement: g.tenementIdDisplay,
    Type: g.typeLabel,
    Holder: g.holder.length > 32 ? `${g.holder.slice(0, 29)}...` : g.holder,
    Granted: g.grantDate,
    Provisional: g.provisional ? "yes" : "",
  }));
  console.table(rows);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[grants-poll] fatal:`, e);
    process.exit(1);
  },
);
