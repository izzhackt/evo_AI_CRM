import { createAiStorageBrokerHandler } from "@/lib/server/ai-agent-storage-broker";

// Внутренний брокер Storage для приватного агента (план ИИ-агента §4.5):
// HMAC EVO_AI_AGENT_STORAGE_SECRET + аренда документа в базе. GET — оригинал
// и страницы, PUT — страницы и вырезки; прочие методы — 405. Edge Caddy
// отвечает 404 на /api/internal/*; маршрут виден только в сети evo_crm_ai.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createAiStorageBrokerHandler();
export const GET = handle;
export const PUT = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
