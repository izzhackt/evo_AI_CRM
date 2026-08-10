import { createPlatformWahaMediaHandler } from "@/lib/server/platform-waha-media-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPlatformWahaMediaHandler();
