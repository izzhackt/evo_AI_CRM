import { createAiLabCritiqueHandler } from "@/lib/server/ai-agent-knowledge-route-handlers";

// «Что не так?» → «Предложить правку»: билет laboratory и поток SSE агента.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createAiLabCritiqueHandler();
