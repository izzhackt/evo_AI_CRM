import { createPlatformCommunicationMediaDownloadHandler } from "../../../../../lib/server/platform-communication-media-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createPlatformCommunicationMediaDownloadHandler();
