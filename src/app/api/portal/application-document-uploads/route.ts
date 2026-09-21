import { createStudentApplicationDocumentUploadHandler } from "@/lib/server/platform-document-storage-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createStudentApplicationDocumentUploadHandler();
