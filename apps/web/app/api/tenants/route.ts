import { NextResponse } from "next/server";
import {
  ADAPTER_CATALOGUE,
  crossCouncilBenchmarks,
  listTenants,
} from "@/lib/tenants";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    tenants: listTenants(),
    catalogue: ADAPTER_CATALOGUE,
    benchmarks: crossCouncilBenchmarks(),
  });
}
