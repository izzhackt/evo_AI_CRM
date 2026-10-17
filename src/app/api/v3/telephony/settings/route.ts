import { createTelephonySettingsHandler } from "../../../../../lib/server/platform-telephony-admin-route-handlers.ts";

// «Настройки → Телефония» (план телефонии §6.4, §12; срез T4b): правка настроек
// одним версионным патчем. Только POST; сессия сотрудника, sameOrigin, право
// telephony.manage; решает и повторяет проверки база (миграция 295).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createTelephonySettingsHandler();
