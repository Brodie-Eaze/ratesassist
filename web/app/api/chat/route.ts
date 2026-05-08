import { NextRequest, NextResponse } from "next/server";
import { runChat, isLive } from "@/lib/llm";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequest = {
  history: ChatMessage[];
  message: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequest;
    if (!body.message?.trim()) {
      return NextResponse.json({ error: "empty message" }, { status: 400 });
    }
    const result = await runChat(body.history ?? [], body.message);
    return NextResponse.json({
      content: result.content,
      toolCalls: result.toolCalls,
      iterations: result.iterations,
      modelUsed: result.modelUsed,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ live: isLive() });
}
