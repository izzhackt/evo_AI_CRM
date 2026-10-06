import { createPlatformInboxPulseHandler } from "../../../../../lib/server/platform-inbox-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createPlatformInboxPulseHandler();
