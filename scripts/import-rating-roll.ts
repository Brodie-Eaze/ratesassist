/**
 * scripts/import-rating-roll.ts — operator CLI for council-side rating-roll
 * ingestion.
 *
 * Reads a CSV from disk, runs `import_rating_roll` through the adapter-demo
 * in-process dispatcher, prints the preview, prompts for confirmation, then
 * commits.
 *
 * Usage:
 *   npm run import-roll -- --council TPS --file scripts/sample-rating-roll.csv
 *   npm run import-roll -- --council TPS --file ./roll.csv --replace
 *   npm run import-roll -- --council TPS --file ./roll.csv --yes   # non-interactive
 *
 * The web UI is for the council clerk's drag-and-drop workflow; this CLI is
 * for the RatesAssist operator running a pilot import from a terminal.
 */

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { _resetInproc, callTool } from "@ratesassist/adapter-demo/inproc";

type Args = {
  council?: string;
  file?: string;
  replace: boolean;
  yes: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { replace: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--council") out.council = argv[++i];
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--replace") out.replace = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
  }
  return out;
}

function usage(): never {
  console.error(
    "Usage: npm run import-roll -- --council TPS --file ./roll.csv [--replace] [--yes]",
  );
  process.exit(2);
}

async function confirmInteractive(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await rl.question(`${prompt} [y/N] `);
    return ans.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.council || !args.file) usage();
  const csvText = await readFile(args.file!, "utf8");
  const mergeStrategy: "replace" | "upsert" = args.replace ? "replace" : "upsert";

  // Reset the in-process singletons so each CLI invocation starts clean.
  _resetInproc();

  // PREVIEW
  const preview = await callTool({
    name: "import_rating_roll",
    input: {
      councilCode: args.council!,
      csvText,
      mergeStrategy,
      confirm: false,
    },
    actorKind: "service",
  });
  if (!preview.ok) {
    console.error(`Preview failed (${preview.code}): ${preview.error}`);
    process.exit(1);
  }
  console.log(preview.output);
  const previewData = (preview.data ?? {}) as {
    validCount?: number;
    errorCount?: number;
    errorPreview?: ReadonlyArray<{ row: number; message: string }>;
  };
  if ((previewData.errorCount ?? 0) > 0) {
    console.log("");
    console.log(`Row errors (${previewData.errorCount}):`);
    for (const err of previewData.errorPreview ?? []) {
      console.log(`  row ${err.row}: ${err.message}`);
    }
  }
  const token = preview.commitToken;
  if (token === undefined) {
    console.error("No commitToken returned; aborting.");
    process.exit(1);
  }

  const proceed =
    args.yes || (await confirmInteractive("Apply this import?"));
  if (!proceed) {
    console.log("Aborted. No changes applied.");
    return;
  }

  // CONFIRM
  const commit = await callTool({
    name: "import_rating_roll",
    input: {
      councilCode: args.council!,
      csvText,
      mergeStrategy,
      confirm: true,
      commitToken: token,
    },
    actorKind: "service",
  });
  if (!commit.ok) {
    console.error(`Commit failed (${commit.code}): ${commit.error}`);
    process.exit(1);
  }
  console.log("");
  console.log(commit.output);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
