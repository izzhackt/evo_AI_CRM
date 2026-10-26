/*
 * Тревога о связи WhatsApp продаж: чистые правила решения (docs/runbooks/whatsapp-go-live.md, раздел «Тревога
 * об отключении и тишине», миграция 321). Здесь нет ни базы, ни сети, ни часов: фоновая задача
 * (`platform-whatsapp-health-maintenance.ts`) приносит наблюдение, состояние из базы и «сейчас» по часам базы,
 * а эти функции отвечают, что записать и какие тревоги открыть или закрыть.
 *
 * Две тревоги, по одной на случай (дедуп держит база: одна открытая тревога вида на сессию):
 *  - `disconnected` — статус сессии не `WORKING` (или сервис WAHA не отвечает) непрерывно не меньше 10 минут;
 *  - `silent` — статус `WORKING`, но входящих сообщений клиентов нет не меньше 3 РАБОЧИХ часов; считаются
 *    только часы внутри рабочего времени (пн–сб, 10:00–20:00 по Бишкеку), открывается тревога только внутри
 *    рабочего времени. Отсчёт тишины идёт от последнего входящего или от момента, когда «работает» впервые
 *    увидели после перерыва (переподключение не должно сразу давать «молчит»).
 * Обе закрываются сами: `disconnected` — как только сессия снова `WORKING`; `silent` — как только пришло
 * сообщение или связь пересоздана после открытия тревоги.
 */

export const WHATSAPP_HEALTH_SESSION = "crm_primary" as const;
export const WHATSAPP_HEALTH_WORKING_STATUS = "WORKING" as const;
/** Статус, который проба выдумывает, когда WAHA недоступен совсем (`platform-waha-live-health.ts`). */
export const WHATSAPP_HEALTH_UNREACHABLE_STATUS = "UNREACHABLE" as const;

/** Не работает непрерывно столько — открывается тревога «отключён». */
export const WHATSAPP_DOWN_THRESHOLD_MS = 10 * 60_000;
/** Столько рабочего времени без входящих — открывается тревога «молчит». */
export const WHATSAPP_SILENT_THRESHOLD_MS = 3 * 3_600_000;
/**
 * Если между двумя проходами прошло больше, чем столько, про промежуток ничего не известно (таймер стоял,
 * контейнер пересоздавался): серия «не работает» / «работает» начинается заново с этого прохода.
 */
export const WHATSAPP_HEALTH_TICK_GAP_MS = 20 * 60_000;

// Рабочее время продаж: пн–сб, 10:00–20:00, Asia/Bishkek (UTC+6, без перехода на летнее время).
export const WHATSAPP_WORKING_UTC_OFFSET_MS = 6 * 3_600_000;
export const WHATSAPP_WORKING_ISO_DAYS: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6]);
export const WHATSAPP_WORKING_OPEN_HOUR = 10;
export const WHATSAPP_WORKING_CLOSE_HOUR = 20;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const STATUS_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

export type WhatsAppHealthAlertKind = "disconnected" | "silent";
export type WhatsAppHealthResolveReason = "working_again" | "messages_arrived" | "reconnected";

/** Слово статуса WAHA в безопасном виде; всё остальное — null. */
export function whatsAppHealthStatusWord(value: unknown): string | null {
  return typeof value === "string" && STATUS_PATTERN.test(value) ? value : null;
}

/** Номер дня недели по ISO (1 — понедельник … 7 — воскресенье) для порядкового дня от эпохи (0 = четверг). */
function isoDayOfWeek(epochDay: number): number {
  return ((((epochDay + 3) % 7) + 7) % 7) + 1;
}

/** Миллисекунды от начала бишкекских суток, в которые попадает момент. */
function localDayStart(ms: number): number {
  return Math.floor((ms + WHATSAPP_WORKING_UTC_OFFSET_MS) / DAY_MS) * DAY_MS - WHATSAPP_WORKING_UTC_OFFSET_MS;
}

function isWorkingDay(dayStartMs: number): boolean {
  const epochDay = Math.floor((dayStartMs + WHATSAPP_WORKING_UTC_OFFSET_MS) / DAY_MS);
  return WHATSAPP_WORKING_ISO_DAYS.includes(isoDayOfWeek(epochDay));
}

/** Рабочее ли время в этот момент (рабочий день, [10:00, 20:00) по Бишкеку). */
export function isWhatsAppWorkingTime(ms: number): boolean {
  if (!Number.isFinite(ms)) return false;
  const dayStart = localDayStart(ms);
  if (!isWorkingDay(dayStart)) return false;
  return ms >= dayStart + WHATSAPP_WORKING_OPEN_HOUR * HOUR_MS && ms < dayStart + WHATSAPP_WORKING_CLOSE_HOUR * HOUR_MS;
}

/**
 * Сколько рабочего времени прошло между двумя моментами. Считает по суткам; с `capMs` останавливается, как
 * только набралось не меньше `capMs` (нужно только «хватило ли»), поэтому очень давнее начало не крутит цикл.
 */
export function whatsAppWorkingElapsedMs(fromMs: number, toMs: number, capMs: number = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
  let total = 0;
  for (let dayStart = localDayStart(fromMs); dayStart < toMs; dayStart += DAY_MS) {
    if (!isWorkingDay(dayStart)) continue;
    const open = dayStart + WHATSAPP_WORKING_OPEN_HOUR * HOUR_MS;
    const close = dayStart + WHATSAPP_WORKING_CLOSE_HOUR * HOUR_MS;
    total += Math.max(0, Math.min(toMs, close) - Math.max(fromMs, open));
    if (total >= capMs) return total;
  }
  return total;
}

/** Что проба увидела: слово статуса WAHA (в том числе `UNREACHABLE`) или «сказать нельзя». */
export type WhatsAppHealthObservation =
  | Readonly<{ kind: "status"; status: string }>
  | Readonly<{ kind: "unknown" }>;

/** Серия наблюдений из базы: последнее слово, время последнего прохода и начало текущей серии (мс от эпохи). */
export type WhatsAppHealthMonitor = Readonly<{ lastStatus: string; lastSeenAt: number; sinceAt: number }>;

export type WhatsAppHealthOpenAlert = Readonly<{ id: string; openedAt: number }>;

export type WhatsAppHealthPlanInput = Readonly<{
  /** Часы базы. */
  now: number;
  observation: WhatsAppHealthObservation;
  monitor: WhatsAppHealthMonitor | null;
  disconnected: WhatsAppHealthOpenAlert | null;
  silent: WhatsAppHealthOpenAlert | null;
  /** Последнее входящее сообщение клиента (по времени получения вебхука) или null. */
  lastInboundAt: number | null;
}>;

export type WhatsAppHealthPlan = Readonly<{
  /** Что записать в серию наблюдений; null — ничего (проба не смогла ответить). */
  observe: Readonly<{ status: string; restart: boolean }> | null;
  open: readonly Readonly<{ kind: WhatsAppHealthAlertKind; status: string }>[];
  resolve: readonly Readonly<{ kind: WhatsAppHealthAlertKind; reason: WhatsAppHealthResolveReason }>[];
  /** Одно фиксированное слово для журнала. */
  verdict: "unknown" | "working" | "down_pending" | "down" | "silent_pending" | "silent";
  /** Минуты в текущей серии «не работает» (для журнала), иначе 0. */
  downMinutes: number;
  /** Рабочие минуты тишины (для журнала), иначе 0. */
  silentWorkingMinutes: number;
}>;

function minutes(ms: number): number {
  return Math.max(0, Math.floor(ms / 60_000));
}

/** Решение одного прохода. Ничего не читает и не пишет: см. комментарий в начале файла. */
export function planWhatsAppHealth(input: WhatsAppHealthPlanInput): WhatsAppHealthPlan {
  const { now, observation, monitor, disconnected, silent, lastInboundAt } = input;
  if (observation.kind !== "status") {
    return Object.freeze({
      observe: null,
      open: Object.freeze([]),
      resolve: Object.freeze([]),
      verdict: "unknown" as const,
      downMinutes: 0,
      silentWorkingMinutes: 0,
    });
  }

  const status = observation.status;
  const working = status === WHATSAPP_HEALTH_WORKING_STATUS;
  const previousWorking = monitor !== null && monitor.lastStatus === WHATSAPP_HEALTH_WORKING_STATUS;
  const hasGap =
    monitor === null ||
    monitor.lastSeenAt > now ||
    monitor.sinceAt > now ||
    now - monitor.lastSeenAt > WHATSAPP_HEALTH_TICK_GAP_MS;
  const restart = hasGap || previousWorking !== working;
  const sinceAt = restart || monitor === null ? now : monitor.sinceAt;
  const observe = Object.freeze({ status, restart });

  const open: { kind: WhatsAppHealthAlertKind; status: string }[] = [];
  const resolve: { kind: WhatsAppHealthAlertKind; reason: WhatsAppHealthResolveReason }[] = [];

  if (!working) {
    const downFor = now - sinceAt;
    const reached = downFor >= WHATSAPP_DOWN_THRESHOLD_MS;
    if (reached && disconnected === null) open.push({ kind: "disconnected", status });
    return Object.freeze({
      observe,
      open: Object.freeze(open),
      resolve: Object.freeze(resolve),
      verdict: reached ? ("down" as const) : ("down_pending" as const),
      downMinutes: minutes(downFor),
      silentWorkingMinutes: 0,
    });
  }

  if (disconnected !== null) resolve.push({ kind: "disconnected", reason: "working_again" });

  // Тишина считается от последнего входящего, но не раньше начала нынешней серии «работает».
  const baseline = lastInboundAt === null ? sinceAt : Math.max(sinceAt, lastInboundAt);
  const silentFor = whatsAppWorkingElapsedMs(baseline, now, WHATSAPP_SILENT_THRESHOLD_MS);
  const reached = silentFor >= WHATSAPP_SILENT_THRESHOLD_MS;
  let verdict: WhatsAppHealthPlan["verdict"] = "working";
  if (silent !== null) {
    if (baseline > silent.openedAt) {
      resolve.push({
        kind: "silent",
        reason: lastInboundAt !== null && lastInboundAt > silent.openedAt ? "messages_arrived" : "reconnected",
      });
    } else {
      verdict = "silent";
    }
  } else if (reached && isWhatsAppWorkingTime(now)) {
    open.push({ kind: "silent", status });
    verdict = "silent";
  } else if (silentFor > 0) {
    verdict = "silent_pending";
  }
  return Object.freeze({
    observe,
    open: Object.freeze(open),
    resolve: Object.freeze(resolve),
    verdict,
    downMinutes: 0,
    silentWorkingMinutes: minutes(silentFor),
  });
}
