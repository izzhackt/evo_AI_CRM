import { createAiLabApplyHandler } from "@/lib/server/ai-agent-knowledge-route-handlers";

// «Применить» предложение Лаборатории: билет lab_apply и ответ агента (409 — изменились).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAiLabApplyHandler();
