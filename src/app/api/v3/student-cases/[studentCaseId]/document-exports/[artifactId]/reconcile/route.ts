import { createDocumentExportReconcileHandler, documentExportMethodNotAllowed } from "../../../../../../../../lib/server/document-export-artifact-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createDocumentExportReconcileHandler();
export const HEAD = () => documentExportMethodNotAllowed("POST");
export const GET = HEAD;
export const PUT = HEAD;
export const PATCH = HEAD;
export const DELETE = HEAD;
export const OPTIONS = HEAD;
