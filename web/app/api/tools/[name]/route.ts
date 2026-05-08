import { NextRequest, NextResponse } from "next/server";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  let input: Record<string, unknown> = {};
  try {
    input = await req.json();
  } catch {
    // empty body fine
  }
  const result = await runTool(name, input);
  return NextResponse.json(result);
}
