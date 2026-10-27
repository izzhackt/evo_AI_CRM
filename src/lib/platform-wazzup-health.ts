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
