import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  try {
    database = db().prepare("SELECT 1 AS ok").get() !== undefined;
  } catch {
    database = false;
  }

  const ready = database;
  return NextResponse.json(
    {
      ok: ready,
      status: ready ? "ready" : "not_ready",
      service: "evo-crm",
      checks: { database },
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
