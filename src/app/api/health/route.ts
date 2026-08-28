import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, status: "live", service: "evo-crm" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
