import { createAiDocumentPageImageHandler } from "@/lib/server/ai-agent-knowledge-route-handlers";

// Картинка страницы документа агента: сессия → ai_agent_document_v1 → Storage.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createAiDocumentPageImageHandler();
