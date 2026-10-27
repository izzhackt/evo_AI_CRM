import { createPlatformWazzupInboundHandler } from "../../../../../../lib/server/platform-wazzup-ingress.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wazzup -> CRM (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.1). Один обработчик на все методы: он отвечает на POST,
// а на остальные - 405 с `Allow: POST`, так что ответ один и тот же на маршруте и в его модульных тестах.
const handler = createPlatformWazzupInboundHandler();

export const POST = handler;
export const GET = handler;
export const HEAD = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
