import { NextResponse } from "next/server";
import { ACTIVITY } from "@/lib/data";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ activity: ACTIVITY });
}
