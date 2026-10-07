import {
  createAiAnswerReadHandler,
  createAiAnswerStreamHandler,
} from "../../../../../../../lib/server/ai-agent-route-handlers.ts";

// «Помочь с ответом» (план ИИ-агента §4.3): GET — сохранённый ответ, POST —
// поток SSE агента через CRM. Ни кэша, ни буферизации.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createAiAnswerReadHandler();
export const POST = createAiAnswerStreamHandler();
