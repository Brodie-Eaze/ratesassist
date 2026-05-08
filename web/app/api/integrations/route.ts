import { NextResponse } from "next/server";
import { INTEGRATIONS } from "@/lib/data";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ integrations: INTEGRATIONS });
}
