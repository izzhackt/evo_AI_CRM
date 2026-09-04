import { createPlatformCompanyFileUploadHandler } from "../../../../../../lib/server/platform-company-file-storage-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPlatformCompanyFileUploadHandler();
