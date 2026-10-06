import { createAiAutosendSendHandler } from "@/lib/server/ai-agent-send";

// Отправка ночного автоответа (план ИИ-агента §11, правило 9; P4): HMAC
// EVO_AI_AGENT_SEND_SECRET, тело ровно {decisionId}, текст берётся у базы.
// Выключено, пока EVO_AI_AGENT_AUTOSEND не ровно 1 (503, без вызовов базы).
// Edge Caddy отвечает 404 на /api/internal/*; маршрут виден только в сети evo_crm_ai.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAiAutosendSendHandler();
