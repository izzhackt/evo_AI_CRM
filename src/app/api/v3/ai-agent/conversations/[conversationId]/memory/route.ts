import {
  createAiMemoryClearHandler,
  createAiMemoryReadHandler,
} from "../../../../../../../lib/server/ai-agent-route-handlers.ts";

// «Что ИИ знает о клиенте» (план ИИ-агента §9, §12.1; P3): GET — память
// диалога и карточка лида, DELETE — «Забыть сводку». Без агента и Gemini.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createAiMemoryReadHandler();
export const DELETE = createAiMemoryClearHandler();
