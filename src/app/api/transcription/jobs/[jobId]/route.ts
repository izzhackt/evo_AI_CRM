import { NextRequest, NextResponse } from "next/server";
import { readJobRecord } from "@/lib/transcription/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const record = await readJobRecord(jobId);
  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(record);
}
