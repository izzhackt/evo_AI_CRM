import { createAiDocumentUploadHandler } from "@/lib/server/ai-agent-knowledge-route-handlers";

// «Информация для агента» (план ИИ-агента §4.5, §7): загрузка файла —
// размер, тип и сигнатура, ClamAV, Storage и ai_agent_document_upload_v1.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAiDocumentUploadHandler();
