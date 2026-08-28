import { NextResponse } from "next/server";

import { probeDatabaseHealth } from "@/lib/server/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const probe = await probeDatabaseHealth();
  if (!probe.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: "blocked",
        service: "evo-crm",
        reason: probe.message,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    { ok: true, status: "live", service: "evo-crm" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
