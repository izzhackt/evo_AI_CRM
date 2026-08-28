import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth";
import { readReleaseMetadata } from "@/lib/release-metadata";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentUser())) {
    return NextResponse.json(
      { error: "authentication_required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const metadata = readReleaseMetadata();
  return NextResponse.json(metadata, {
    status: metadata.status === "available" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
