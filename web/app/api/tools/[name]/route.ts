import { NextRequest, NextResponse } from "next/server";
import { runTool, isKnownTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const correlationId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!isKnownTool(name)) {
    return NextResponse.json({ error: "unknown_tool" }, { status: 404 });
  }

  let input: Record<string, unknown> = {};
  try {
    input = await req.json();
  } catch {
    // empty body fine
  }

  try {
    const result = await runTool(name, input);
    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error("[tool]", correlationId, name, e);
    return NextResponse.json(
      { error: "tool_error", correlationId },
      { status: 500 },
    );
  }
}
