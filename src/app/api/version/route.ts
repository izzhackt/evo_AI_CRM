import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { resolvePlatformActor } from "@/lib/platform-auth";
import { readReleaseMetadata } from "@/lib/release-metadata";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

export const dynamic = "force-dynamic";

async function hasAuthenticatedStaffSession(): Promise<boolean> {
  if (isUiContractFixtureMode()) {
    const user = await currentUser();
    return user !== null && user.role !== "client";
  }

  const result = await resolvePlatformActor();
  return result.status === "authenticated" && result.actor.platformRole !== "student";
}

export async function GET() {
  if (!(await hasAuthenticatedStaffSession())) {
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
