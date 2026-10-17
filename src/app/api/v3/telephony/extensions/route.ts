import { createTelephonyExtensionHandler } from "../../../../../lib/server/platform-telephony-admin-route-handlers.ts";

// «Настройки → Телефония» (план телефонии §6.3, §12; срез T4b): сопоставление
// пользователя ВАТС и сотрудника EVO. Только POST; сессия сотрудника,
// sameOrigin, право telephony.manage; решает и повторяет проверки база.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createTelephonyExtensionHandler();
