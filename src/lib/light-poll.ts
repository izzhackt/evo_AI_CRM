/**
 * Лёгкий опрос (A4, docs/PLAN_CHANGES.md 19.10.2026). Один запрос раз в минуту
 * возвращает число непрочитанных и «версию» данных раздела; страница
 * перечитывается только когда версия изменилась. Движок один для кабинета
 * студента и колокольчика CRM; вёрстки и сети здесь нет, всё внешнее (время,
 * таймеры, видимость, сеть) приходит зависимостями, поэтому логика проверяется
 * тестами без браузера.
 *
 * Расписание:
 * - раз в `POLL_BASE_MS`; после сбоя задержка удваивается (120, 240, 480 с,
 *   не больше `POLL_MAX_DELAY_MS`) и сбрасывается первым успехом;
 * - скрытая вкладка запросов не делает и таймер не держит; при возврате
 *   опрос идёт не раньше чем через `RESUME_MIN_GAP_MS` после прошлого;
 * - возврат сети — один опрос сразу и сброс задержки;
 * - один запрос в полёте за раз; запрос без ответа дольше
 *   `REQUEST_TIMEOUT_MS` обрывается и считается сбоем, чтобы зависший сокет
 *   не остановил опрос навсегда.
 */

export const POLL_BASE_MS = 60_000;
export const POLL_MAX_DELAY_MS = 600_000;
export const RESUME_MIN_GAP_MS = 30_000;
/** Запрос, не ответивший за это время (сон, мёртвый сокет), считается сбоем. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Задержка до следующего опроса после `failures` сбоев подряд. */
export function nextPollDelay(failures: number): number {
  const exponent = Number.isFinite(failures) ? Math.min(Math.max(0, Math.trunc(failures)), 10) : 0;
  return Math.min(POLL_BASE_MS * 2 ** exponent, POLL_MAX_DELAY_MS);
}

/** Возврат на вкладку или в фокус: опрашивать, только если прошлый был давно. */
export function shouldPollOnResume(lastPollAt: number | null, now: number): boolean {
  return lastPollAt === null || now - lastPollAt >= RESUME_MIN_GAP_MS;
}

export type LightPollState = Readonly<{
  /** Ревизия сервера или null (локальный запуск без метки выпуска). */
  release: string | null;
  unread: number;
  /** Хэш данных раздела; null — версия неизвестна, страницу не перечитывать. */
  version: string | null;
}>;

export type LightPollResult =
  | Readonly<{ kind: "ok"; state: LightPollState }>
  /** 401/403: сессии нет или это не тот пользователь. */
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "error" }>;

const VERSION_PATTERN = /^[0-9a-f]{32}$/u;
const RELEASE_PATTERN = /^[0-9a-f]{40}$/u;

/** Строгий разбор тела ответа; всё лишнее или неполное — null. */
export function parseLightPollBody(body: unknown): LightPollState | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { release, unread, version } = body as Record<string, unknown>;
  if (typeof unread !== "number" || !Number.isSafeInteger(unread) || unread < 0) return null;
  if (version !== null && (typeof version !== "string" || !VERSION_PATTERN.test(version))) return null;
  if (release !== null && (typeof release !== "string" || !RELEASE_PATTERN.test(release))) return null;
  return { release, unread, version };
}

/** Запрос состояния из браузера. Сеть и разбор — здесь, расписание — в движке. */
export async function fetchLightPoll(url: string, signal?: AbortSignal): Promise<LightPollResult> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });
    if (response.status === 401 || response.status === 403) return { kind: "denied" };
    if (!response.ok) return { kind: "error" };
    const state = parseLightPollBody(await response.json());
    return state ? { kind: "ok", state } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

export type LightPollerDependencies = Readonly<{
  now: () => number;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isVisible: () => boolean;
  /** Страница уже на прошлой сборке: опросы стоят (stale-deployment.ts). */
  isStale: () => boolean;
  fetchState: (signal: AbortSignal) => Promise<LightPollResult>;
  onState: (state: LightPollState) => void;
  /** Версия раздела изменилась (не первое чтение). */
  onChange: () => void;
  /** Сервер уже другой сборки, чем у этой страницы. */
  onRelease: (release: string | null) => void;
  onFailure: (kind: "denied" | "error") => void;
}>;

export type LightPoller = Readonly<{
  /** Начать: первый опрос сразу (`immediate`) или через обычную задержку. */
  start: (options?: Readonly<{ immediate?: boolean }>) => void;
  stop: () => void;
  /** Возврат во вкладку или в фокус. */
  resume: () => void;
  /** Вернулась сеть: сбросить задержку и опросить. */
  online: () => void;
  /** Кнопка «Повторить»: опросить сейчас. */
  retry: () => void;
}>;

export function createLightPoller(dependencies: LightPollerDependencies): LightPoller {
  let timer: unknown = null;
  let guardTimer: unknown = null;
  let controller: AbortController | null = null;
  let failures = 0;
  let lastPollAt: number | null = null;
  let running = false;
  let stopped = true;
  // Версия раздела при последнем чтении; первое чтение только запоминает её:
  // содержимое страницы уже пришло с маршрутом.
  let known: string | null = null;

  const clear = () => {
    if (timer !== null) dependencies.clearTimer(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    if (stopped || dependencies.isStale() || !dependencies.isVisible()) return;
    timer = dependencies.setTimer(() => { timer = null; void poll(); }, nextPollDelay(failures));
  };

  async function poll(): Promise<void> {
    if (stopped || running || dependencies.isStale() || !dependencies.isVisible()) return;
    clear();
    running = true;
    lastPollAt = dependencies.now();
    const own = new AbortController();
    controller = own;
    const signal = own.signal;
    guardTimer = dependencies.setTimer(() => own.abort(), REQUEST_TIMEOUT_MS);
    try {
      const result = await dependencies.fetchState(signal);
      if (stopped) return;
      if (result.kind !== "ok") {
        failures += 1;
        dependencies.onFailure(result.kind);
        return;
      }
      failures = 0;
      dependencies.onRelease(result.state.release);
      if (dependencies.isStale()) return;
      dependencies.onState(result.state);
      const { version } = result.state;
      if (version !== null) {
        const changed = known !== null && version !== known;
        known = version;
        if (changed) dependencies.onChange();
      }
    } catch {
      if (!stopped) {
        failures += 1;
        dependencies.onFailure("error");
      }
    } finally {
      if (guardTimer !== null) dependencies.clearTimer(guardTimer);
      guardTimer = null;
      running = false;
      if (!stopped) schedule();
    }
  }

  return {
    start(options = {}) {
      stopped = false;
      known = null;
      failures = 0;
      if (options.immediate === false) schedule();
      else void poll();
    },
    stop() {
      stopped = true;
      clear();
      if (guardTimer !== null) dependencies.clearTimer(guardTimer);
      guardTimer = null;
      controller?.abort();
    },
    resume() {
      if (stopped || running || !dependencies.isVisible()) return;
      if (shouldPollOnResume(lastPollAt, dependencies.now())) void poll();
      else schedule();
    },
    online() {
      if (stopped) return;
      failures = 0;
      void poll();
    },
    retry() {
      if (!stopped) void poll();
    },
  };
}
