import { createDocumentExportHandlers, documentExportMethodNotAllowed } from "../../../../../../lib/server/document-export-artifact-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createDocumentExportHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const HEAD = () => documentExportMethodNotAllowed();
export const PUT = HEAD;
export const PATCH = HEAD;
export const DELETE = HEAD;
export const OPTIONS = HEAD;
