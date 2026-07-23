import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { publicJobRecord, readJobRecord, removeJob } from "@/lib/transcription/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const authorization = await requireAdminApi();
  if (authorization.response) return authorization.response;
  const { jobId } = await params;
  const record = await readJobRecord(jobId);
  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(publicJobRecord(record));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const authorization = await requireAdminApi();
  if (authorization.response) return authorization.response;
  const { jobId } = await params;
  const record = await readJobRecord(jobId);
  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await removeJob(jobId);
  return new Response(null, { status: 204 });
}
