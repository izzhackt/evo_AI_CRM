import { createPlatformWahaHistoryHandler } from "@/lib/server/platform-waha-history-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformWahaHistoryHandler();
