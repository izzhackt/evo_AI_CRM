import { createAiLabAskHandler } from "@/lib/server/ai-agent-knowledge-route-handlers";

// «Спросите как клиент»: билет laboratory и поток SSE агента через CRM.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAiLabAskHandler();
