import { createPlatformAutonomousReplyHandler } from "@/lib/server/platform-autonomous-reply-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformAutonomousReplyHandler();
