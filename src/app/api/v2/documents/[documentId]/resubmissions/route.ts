import { createPrivateDocumentResubmissionHandler } from "../../../../../../lib/server/private-document-route-handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createPrivateDocumentResubmissionHandler();
