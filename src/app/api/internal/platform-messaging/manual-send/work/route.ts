import { createPlatformManualSendHandler } from "@/lib/server/platform-manual-send-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformManualSendHandler();
