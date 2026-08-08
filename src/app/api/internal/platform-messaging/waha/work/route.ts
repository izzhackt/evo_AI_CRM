import { createPlatformWahaWorkHandler } from "@/lib/server/platform-waha-work-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformWahaWorkHandler();
