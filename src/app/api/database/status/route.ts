import { NextResponse } from "next/server";

import { readDatabaseStatus } from "@/lib/server/database-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readDatabaseStatus();
  return NextResponse.json(status, {
    status: status.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
