import { createPlatformCompanyKnowledgeDownloadHandler } from "../../../../../../../lib/server/platform-company-knowledge-storage-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createPlatformCompanyKnowledgeDownloadHandler();
