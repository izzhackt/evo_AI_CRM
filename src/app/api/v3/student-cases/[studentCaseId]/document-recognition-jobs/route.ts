import { createDocumentRecognitionHandlers, documentRecognitionMethodNotAllowed } from "../../../../../../lib/server/document-recognition-route-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createDocumentRecognitionHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const HEAD = documentRecognitionMethodNotAllowed;
export const PUT = documentRecognitionMethodNotAllowed;
export const PATCH = documentRecognitionMethodNotAllowed;
export const DELETE = documentRecognitionMethodNotAllowed;
export const OPTIONS = documentRecognitionMethodNotAllowed;
