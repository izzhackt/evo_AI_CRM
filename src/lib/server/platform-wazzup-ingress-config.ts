import "server-only";

import { WAZZUP_WEBHOOK_TOKEN_PATTERN } from "../platform-wazzup-webhook.ts";

/**
 * Приём WhatsApp через Wazzup: настройка (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.1, §5.5, §9).
 *
 * Wazzup у Sidecar-ключа ничего не подписывает: единственный секрет - токен в адресе вебхука (`?token=`), 64
 * шестнадцатеричных знака. Он сравнивается на каждом запросе, поэтому лежит в env приложения (как ключ приёма
 * телефонии), и его правка - выпуск. Ключ API Wazzup здесь не участвует: он в Supabase Vault.
 */

export type PlatformWazzupWebhookTokens = Readonly<{
  current: string;
  /** Только пока идёт ротация (§5.5); никогда не равен `current`. */
  next: string | null;
}>;

/**
 * Аварийный стоп приёма: ровно "1" - «приём разрешён», всё остальное закрывает маршрут (503). Это не рабочий выключатель:
 * рабочий лежит в базе (`whatsapp_transport_state.active_transport`) и меняется командой оператора без выпуска (§5.5).
 */
export function isPlatformWazzupIngressEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.EVO_PLATFORM_WAZZUP_INGRESS_ENABLED === "1";
}

function wellFormed(value: string | undefined): value is string {
  return value !== undefined && WAZZUP_WEBHOOK_TOKEN_PATTERN.test(value);
}

/**
 * Принимаемые токены или null, когда годного нет (маршрут отвечает 503 до чтения тела). Негодный или совпавший с текущим
 * `…_NEXT` игнорируется, а не гасит годный текущий: контракт env всё равно не выпустит такой файл.
 */
export function readPlatformWazzupWebhookTokens(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PlatformWazzupWebhookTokens | null {
  const current = environment.EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN;
  if (!wellFormed(current)) return null;
  const next = environment.EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT;
  return Object.freeze({ current, next: wellFormed(next) && next !== current ? next : null });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Владелец новых бесед (`EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID`, тот же, что у WAHA, §5.3) или null. Без него
 * встроенная проекция и догрузка не запускаются: события остаются сохранёнными и ждут.
 */
export function readPlatformWazzupIntakeOwner(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const value = environment.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID;
  if (value === undefined || value !== value.trim() || !/^[0-9a-fA-F-]{36}$/u.test(value)) return null;
  const normalized = value.toLowerCase();
  return UUID_PATTERN.test(normalized) && normalized !== NIL_UUID ? normalized : null;
}
