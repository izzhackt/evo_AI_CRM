/*
 * Здоровье канала Wazzup и суточная сверка: чистые правила (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.2, §5.4).
 * Сети, базы и часов здесь нет: задача таймера (`server/platform-wazzup-maintenance.ts`) приносит слово состояния канала
 * Wazzup, счётчики и «сейчас», а эти функции отвечают, какое слово записать в серию 321 и что считать расхождением.
 * Решения о тревоге («не работает 10 минут», «молчит 3 рабочих часа») остаются в `platform-whatsapp-health.ts`.
 *
 * Состояния канала - страницы «Работа с каналами» (wazzup24.ru/help/api-ru/rabota-s-kanalami/) и «Webhooks»
 * (`channelsUpdates`), прочитаны 27.10.2026. Страницы расходятся в написании: русская даёт `qridle`, `openelsewhere`,
 * `blocked`; английская и вебхук - `qr`, `openElsewhere`, без `blocked`. Поэтому слова сравниваются без учёта регистра и
 * принимаются оба написания.
 */

export const WAZZUP_HEALTH_SESSION = "wazzup" as const;

/** Старше этого возраста самое старое непроецированное событие - «деградация» (§5.2). */
export const WAZZUP_BACKLOG_DEGRADED_SECONDS = 30 * 60;

/** Слово, которое таймер записывает в серию 321, когда ключ не принят / API недоступен / канала нет в списке. */
export const WAZZUP_KEY_REJECTED_WORD = "KEY_REJECTED" as const;
export const WAZZUP_UNREACHABLE_WORD = "UNREACHABLE" as const;
export const WAZZUP_CHANNEL_MISSING_WORD = "CHANNEL_MISSING" as const;

const STATE_WORDS: ReadonlyMap<string, string> = new Map([
  ["active", "WORKING"],
  ["init", "STARTING"],
  ["phoneunavailable", "PHONE_UNAVAILABLE"],
  ["qr", "SCAN_QR_CODE"],
  ["qridle", "SCAN_QR_CODE"],
  ["openelsewhere", "OPEN_ELSEWHERE"],
  ["notenoughmoney", "NOT_PAID"],
  ["unauthorized", "UNAUTHORIZED"],
  ["disabled", "DISABLED"],
  ["foreignphone", "FOREIGN_PHONE"],
  ["waitforpassword", "WAIT_FOR_PASSWORD"],
  ["blocked", "BLOCKED"],
  ["onmoderation", "ON_MODERATION"],
  ["rejected", "REJECTED"],
]);

const STATUS_WORD = /^[A-Z][A-Z0-9_]{0,63}$/u;

/**
 * Слово состояния канала Wazzup -> слово серии 321 (`^[A-Z][A-Z0-9_]{0,63}$`). Незнакомое состояние не теряется и не
 * считается рабочим: camelCase становится SNAKE_CASE (`newBrokenState` -> `NEW_BROKEN_STATE`), негодное - `UNKNOWN_STATE`.
 */
export function wazzupStateHealthWord(state: string): string {
  const known = STATE_WORDS.get(state.toLowerCase());
  if (known !== undefined) return known;
  const converted = state
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .toUpperCase();
  return STATUS_WORD.test(converted) ? converted : "UNKNOWN_STATE";
}

/** Действующий путь WhatsApp в базе (`whatsapp_transport_state.active_transport`; нет строки = `none`). */
export type WazzupDatabaseTransport = "none" | "waha" | "wazzup";

/** Ответ `platform.whatsapp_transport_read_v1` (миграция 326), сведённый к тому, что нужно таймеру. */
export type WazzupTransportRead = Readonly<{
  transport: WazzupDatabaseTransport;
  aiTriggerEnabled: boolean;
  geminiEnabled: boolean;
  /** Привязанный канал приёма (`wazzup_channels.channel_id`) или null, когда канал не привязан. */
  channelId: string | null;
}>;

const CHANNEL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Строгий разбор ответа чтения пути: слово пути из закрытого списка, два выключателя - булевы, канал - null или объект
 * с идентификатором канала. Любое другое - null (вызывающий считает это сбоем базы, а не «пути нет»). Ключей, номера и
 * хеша в ответе нет, и здесь они не читаются.
 */
export function parseWazzupTransportRead(value: unknown): WazzupTransportRead | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const transport = record.transport;
  if (transport !== "none" && transport !== "waha" && transport !== "wazzup") return null;
  if (typeof record.aiTriggerEnabled !== "boolean" || typeof record.geminiEnabled !== "boolean") return null;
  if (!Object.hasOwn(record, "channel")) return null;
  let channelId: string | null = null;
  if (record.channel !== null) {
    const channel = record.channel;
    if (typeof channel !== "object" || Array.isArray(channel)) return null;
    const id = (channel as Record<string, unknown>).channelId;
    if (typeof id !== "string" || !CHANNEL_UUID.test(id)) return null;
    channelId = id;
  }
  return Object.freeze({ transport, aiTriggerEnabled: record.aiTriggerEnabled, geminiEnabled: record.geminiEnabled, channelId });
}

/**
 * Расхождение переключателей env и пути в базе (план §9, таблица состояний). Слова:
 *  - `env_wazzup_on_db_waha` - env Wazzup `1`, путь `waha` (строка 3 таблицы): маршрут Wazzup отвечает 503
 *    `transport_inactive`, а приём WAHA по контракту env выключен - не принимает никто;
 *  - `env_wazzup_off_db_wazzup` - аварийный стоп закрыт, путь `wazzup` (строка 4): маршрут отвечает 503, канал может быть
 *    рабочим, ответы остаются закрытыми;
 *  - `env_waha_off_db_waha` - путь `waha`, а приём WAHA в env выключен: не принимает никто;
 *  - `env_waha_on_db_wazzup` - путь `wazzup`, а приём WAHA в env включён: два приёма на один номер (контракт env такой
 *    выпуск не допускает; слово ловит ручную правку env).
 * Путь `none` расхождением не считается (норма до переключения и после быстрого отката, строка 2). null - всё сходится.
 */
export type WazzupTransportMismatch =
  | "env_wazzup_on_db_waha"
  | "env_wazzup_off_db_wazzup"
  | "env_waha_off_db_waha"
  | "env_waha_on_db_wazzup";

export function wazzupTransportMismatch(input: Readonly<{
  transport: WazzupDatabaseTransport;
  /** `EVO_PLATFORM_WAZZUP_INGRESS_ENABLED === "1"`. */
  wazzupIntakeOn: boolean;
  /** `EVO_PLATFORM_WAHA_INGRESS_ENABLED === "1"`. */
  wahaIntakeOn: boolean;
}>): WazzupTransportMismatch | null {
  if (input.transport === "waha") {
    if (input.wazzupIntakeOn) return "env_wazzup_on_db_waha";
    if (!input.wahaIntakeOn) return "env_waha_off_db_waha";
    return null;
  }
  if (input.transport === "wazzup") {
    if (!input.wazzupIntakeOn) return "env_wazzup_off_db_wazzup";
    if (input.wahaIntakeOn) return "env_waha_on_db_wazzup";
    return null;
  }
  return null;
}

/** Допуск суточной сверки: max(3, 2 % от числа amoCRM) (§5.4 в). */
export function wazzupReconciliationTolerance(amoCount: number): number {
  return Math.max(3, Math.ceil(amoCount * 0.02));
}

export type WazzupReconciliationVerdict = "match" | "gap" | "evo_ahead";

/**
 * Сверка количеств входящих за сутки. `gap` - в EVO меньше, чем в amoCRM, больше допуска (тревога «В EVO меньше входящих
 * WhatsApp, чем в amoCRM»). Когда в EVO больше (amoCRM считает иначе, дубли у Wazzup), это не потеря - `evo_ahead`, без
 * тревоги; в пределах допуска - `match` (закрывает открытую тревогу `counts_match`).
 */
export function wazzupReconciliationVerdict(evoCount: number, amoCount: number): WazzupReconciliationVerdict {
  const tolerance = wazzupReconciliationTolerance(amoCount);
  if (evoCount < amoCount - tolerance) return "gap";
  if (evoCount > amoCount + tolerance) return "evo_ahead";
  return "match";
}

const BISHKEK_OFFSET_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
/** Сверка идёт не раньше 00:10 по Бишкеку и не позже 06:00: повторы в окне безопасны (тревога и закрытие идемпотентны). */
export const WAZZUP_RECONCILIATION_OPEN_MINUTE = 10;
export const WAZZUP_RECONCILIATION_CLOSE_HOUR = 6;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Пора ли сверять и за какие сутки. Окно - [00:10, 06:00) по Бишкеку (UTC+6 без перехода на летнее время); сутки
 * сверки - прошедшие бишкекские сутки (`YYYY-MM-DD`). Таймер не хранит «уже сверено»: первый проход после 00:10 делает
 * сверку, остальные проходы окна повторяют её без вреда.
 */
export function wazzupReconciliationWindow(nowMs: number): Readonly<{ due: boolean; day: string }> {
  if (!Number.isFinite(nowMs)) return Object.freeze({ due: false, day: "1970-01-01" });
  const local = nowMs + BISHKEK_OFFSET_MS;
  const minuteOfDay = Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / 60_000);
  const due = minuteOfDay >= WAZZUP_RECONCILIATION_OPEN_MINUTE && minuteOfDay < WAZZUP_RECONCILIATION_CLOSE_HOUR * 60;
  return Object.freeze({ due, day: isoDate(local - DAY_MS) });
}
