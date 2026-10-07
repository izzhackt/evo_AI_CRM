import { createAiReviewCropHandler } from "@/lib/server/ai-agent-knowledge-route-handlers";

// Вырезка пункта «Листа сверки»: сессия → ai_agent_document_v1 → Storage.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createAiReviewCropHandler();
