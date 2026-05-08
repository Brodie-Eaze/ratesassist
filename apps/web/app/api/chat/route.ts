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
  const correlationId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    console.error("[chat]", correlationId, e);
    return NextResponse.json(
      { error: "internal_error", correlationId },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ live: isLive() });
}
