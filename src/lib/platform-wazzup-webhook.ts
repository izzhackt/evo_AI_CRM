/*
 * WhatsApp через Wazzup, этап 1 (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.1): чистые правила разбора вебхука
 * Wazzup. Здесь нет ни сети, ни базы, ни часов, ни env: маршрут приёма (`server/platform-wazzup-ingress.ts`) и команда
 * оператора (`server/platform-wazzup-ops.ts`) берут отсюда адрес, предел тела, разбор верхнего уровня и деление на порции.
 *
 * Документация Wazzup (wazzup24.ru/help/api-ru/webhooks-2/, прочитано 27.10.2026): вебхук - POST JSON на один адрес
 * аккаунта (до 200 знаков, query допускается); верхний уровень несёт массивы `messages`, `statuses`, `channelsUpdates`
 * (подписки `messagesAndStatuses`, `channelsUpdates`), либо `createContact` / `createDeal` (подписка
 * `contactsAndDealsCreation`), либо `templateStatus` (WABA); при `PATCH /v3/webhooks` Wazzup шлёт `{"test": true}` и ждёт
 * 200; ответ ждут 200 за 30 секунд; о повторах при ошибке страница молчит.
 */

/** Единственный публичный хост, на котором путь принимает вебхуки (на `app.` он закрыт, §5.7). */
export const WAZZUP_WEBHOOK_HOST = "crm.evoadmissions.com" as const;
export const WAZZUP_WEBHOOK_PATH = "/api/v2/whatsapp/wazzup/inbound" as const;
export const WAZZUP_WEBHOOK_ORIGIN = `https://${WAZZUP_WEBHOOK_HOST}` as const;
/** Предел адреса вебхука у Wazzup: 200 знаков. */
export const WAZZUP_WEBHOOK_URI_MAX_CHARS = 200;
/** Токен адреса: 64 шестнадцатеричных знака (`openssl rand -hex 32`). */
export const WAZZUP_WEBHOOK_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;

/** Предел тела: 1 МиБ (WAHA - 256 КиБ): после простоя телефона Wazzup может прислать накопленное одним вебхуком. */
export const WAZZUP_MAX_BODY_BYTES = 1024 * 1024;
/** Столько элементов принимает за вызов `wazzup_webhook_persist_v1` (миграция 325). */
export const WAZZUP_PORTION_SIZE = 100;
/** Столько счётчика влезает в одно значение `p_counters` (`^[0-9]{1,7}$`). */
export const WAZZUP_COUNTER_MAX = 9_999_999;

export type WazzupElementKind = "message" | "channel";
export type WazzupElement = Readonly<{ kind: WazzupElementKind; element: unknown }>;

export type WazzupPayloadClass =
  /** Проверка `PATCH /v3/webhooks`: ровно `{"test": true}`. */
  | Readonly<{ kind: "test" }>
  | Readonly<{
      kind: "batch";
      /** Сообщения и состояния каналов, в порядке тела; негодная форма массива уходит одним элементом (станет `unparsed`). */
      elements: readonly WazzupElement[];
      /** Статусы исходящих: в этапе 1 только число (миграция 325, счётчик `status`). */
      statuses: number;
      /** Подписки, которые мы не включали, и неизвестные ключи верхнего уровня: только число (`ignored_subscription`). */
      ignored: number;
    }>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampCounter(value: number): number {
  return Math.min(Math.max(0, Math.floor(value)), WAZZUP_COUNTER_MAX);
}

function elementsOf(kind: WazzupElementKind, value: unknown): readonly WazzupElement[] {
  // Не массив - тоже сохраняем, одним элементом: база запишет его как `unparsed` (доказательство, а не потеря).
  if (!Array.isArray(value)) return [{ kind, element: value }];
  return value.map((element) => ({ kind, element }));
}

/**
 * Разбор разобранного JSON верхнего уровня (§5.1, пп. 7-8). Возвращает null, когда это не объект: такое тело - ошибка
 * формы (400), а не вебхук.
 */
export function classifyWazzupPayload(value: unknown): WazzupPayloadClass | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  // `{"test": true}` и только он: любое другое тело с ключом test - обычный разбор (неизвестный ключ).
  if (keys.length === 1 && keys[0] === "test" && value.test === true) return { kind: "test" };

  const elements: WazzupElement[] = [];
  let statuses = 0;
  let ignored = 0;
  for (const key of keys) {
    if (key === "messages") elements.push(...elementsOf("message", value[key]));
    else if (key === "channelsUpdates") elements.push(...elementsOf("channel", value[key]));
    else if (key === "statuses") statuses += Array.isArray(value[key]) ? (value[key] as unknown[]).length : 1;
    // `createContact` / `createDeal` / `templateStatus` и всё незнакомое: подписки выключены, это сигнал ошибки настройки.
    else ignored += 1;
  }
  return { kind: "batch", elements, statuses: clampCounter(statuses), ignored: clampCounter(ignored) };
}

/** Делит элементы на порции не больше `size` (по умолчанию 100): предел вызова записи в базе. */
export function splitWazzupPortions<T>(items: readonly T[], size: number = WAZZUP_PORTION_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("portion size must be a positive integer");
  const portions: T[][] = [];
  for (let index = 0; index < items.length; index += size) portions.push(items.slice(index, index + size));
  return portions;
}

/**
 * Время элемента для порядка проекции: `dateTime` Wazzup (`yyyy-mm-ddThh:mm:ss.ms`, без пояса) читается как UTC, как
 * в миграции 325 (`::TIMESTAMPTZ` на сервере в UTC). Нечитаемое время - null (элемент идёт в конец).
 */
export function wazzupElementTimeMs(element: unknown): number | null {
  if (!isObject(element) || typeof element.dateTime !== "string") return null;
  const text = element.dateTime;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(text) ? text : `${text}Z`;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Полный адрес вебхука с токеном. Не длиннее 200 знаков: 131 при токене из 64 знаков. */
export function buildWazzupWebhookUri(token: string): string {
  if (!WAZZUP_WEBHOOK_TOKEN_PATTERN.test(token)) throw new RangeError("wazzup webhook token must be 64 hex characters");
  const uri = `${WAZZUP_WEBHOOK_ORIGIN}${WAZZUP_WEBHOOK_PATH}?token=${token}`;
  if (uri.length > WAZZUP_WEBHOOK_URI_MAX_CHARS) throw new RangeError("wazzup webhook address is too long");
  return uri;
}
