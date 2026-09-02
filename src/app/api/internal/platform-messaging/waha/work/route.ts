import { createPlatformWahaProjectionRecoveryHandler } from "@/lib/server/platform-waha-projection-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformWahaProjectionRecoveryHandler();
