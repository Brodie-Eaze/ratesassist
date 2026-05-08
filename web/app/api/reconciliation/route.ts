import { NextResponse } from "next/server";
import { BANK_DEPOSITS } from "@/lib/data";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ deposits: BANK_DEPOSITS });
}
