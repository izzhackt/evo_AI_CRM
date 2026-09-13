import { createDocumentExportDownloadHandler, documentExportMethodNotAllowed } from "../../../../../../../../lib/server/document-export-artifact-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createDocumentExportDownloadHandler();
export const HEAD = () => documentExportMethodNotAllowed("GET");
export const POST = HEAD;
export const PUT = HEAD;
export const PATCH = HEAD;
export const DELETE = HEAD;
export const OPTIONS = HEAD;
