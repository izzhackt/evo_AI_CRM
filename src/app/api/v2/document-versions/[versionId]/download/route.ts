import { createPlatformDocumentDownloadHandler } from "../../../../../../lib/server/platform-document-storage-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createPlatformDocumentDownloadHandler();
