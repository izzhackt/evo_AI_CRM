import { createWhatsAppConnectHandler } from "../../../../../lib/server/platform-waha-connect-route-handlers.ts";

// «Настройки → Интеграции → Подключение WhatsApp» (решение владельца 20.10.2026):
// запуск сессии, QR и код по номеру. Только POST; сессия администратора, sameOrigin,
// не просмотр роли; лимиты и след — в сервисе. Ответы без кеша.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createWhatsAppConnectHandler();
