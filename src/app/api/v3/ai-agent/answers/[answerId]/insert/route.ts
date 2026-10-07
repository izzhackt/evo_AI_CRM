import { createAiAnswerInsertHandler } from "../../../../../../../lib/server/ai-agent-route-handlers.ts";

// «Вставить в ответ»: проверенный сохранённый текст, 409 — ответ устарел.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAiAnswerInsertHandler();
