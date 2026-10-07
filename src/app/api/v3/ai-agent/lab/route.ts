import { createAiLabStateHandler } from "@/lib/server/ai-agent-knowledge-route-handlers";

// «Лаборатория» (план ИИ-агента §8): своя проверка и предложение (ai_agent_lab_v1).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createAiLabStateHandler();
