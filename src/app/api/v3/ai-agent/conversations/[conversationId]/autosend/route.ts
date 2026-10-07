import {
  createAiAutosendChatExclusionHandler,
  createAiAutosendChatReadHandler,
} from "../../../../../../../lib/server/ai-agent-route-handlers.ts";

// «Автоответчик в этом чате» (план ИИ-агента §11, §12.1; P4): GET — состояние
// автоответчика для чата, PUT — исключить чат или вернуть. Ничего не отправляет.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createAiAutosendChatReadHandler();
export const PUT = createAiAutosendChatExclusionHandler();
