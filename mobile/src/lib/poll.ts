// Планировщик опроса: следующий запуск ставится ПОСЛЕ завершения предыдущего, поэтому
// запросы не накладываются. Пауза и возобновление — для фона и скрытого экрана.
//
// Как у лёгкого опроса веба (`src/lib/light-poll.ts`, A4): запуск, который бросил исключение, считается сбоем, и пока сбои идут
// подряд, задержка до следующего растёт (`delayAfterFailures`); первый успех возвращает обычный интервал. Возврат из фона
// опрашивает сразу, только если прошлый запуск начался не меньше чем `resumeMinGapMs` назад (веб RESUME_MIN_GAP_MS), иначе
// просто ставит обычный отсчёт: частые переключения приложений не засыпают сервер запросами.
export type Poller = Readonly<{
  start: () => void;
  stop: () => void;
  /** Внеочередной запуск (после отправки, смены раздела, кнопки «Повторить»): отсчёт начинается заново. */
  poke: () => void;
  /** Приложение ушло в фон: отсчёт стоит, внеочередные запуски не идут. */
  pause: () => void;
  /** Приложение вернулось: опросить сразу, если прошлый запуск был давно, иначе поставить обычный отсчёт. */
  resume: () => void;
}>;

export type PollerOptions = Readonly<{
  intervalMs: number;
  run: () => Promise<unknown> | unknown;
  /**
   * Задержка до следующего запуска после `failures` сбоев подряд (0: сбоев нет). Без неё интервал постоянный, а сбой
   * запуска, как раньше, не меняет расписание.
   */
  delayAfterFailures?: (failures: number) => number;
  /** `resume` опрашивает сразу, только если прошлый запуск начался не меньше чем столько назад. 0 (по умолчанию): всегда сразу. */
  resumeMinGapMs?: number;
  now?: () => number;
}>;

export function createPoller(options: PollerOptions): Poller {
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = false;
  let paused = false;
  let running = false;
  let failures = 0;
  let lastRunAt: number | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (!active || paused || timer !== null || running) return;
    const delay = options.delayAfterFailures ? options.delayAfterFailures(failures) : options.intervalMs;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delay);
  };
  const tick = async () => {
    if (!active || paused || running) return;
    clear();
    running = true;
    lastRunAt = now();
    try {
      await options.run();
      failures = 0;
    } catch {
      // сбой одного опроса не останавливает следующий; он удлиняет задержку (если она задана)
      failures += 1;
    } finally {
      running = false;
      schedule();
    }
  };
  return {
    start() {
      if (active) return;
      active = true;
      paused = false;
      failures = 0;
      schedule();
    },
    stop() {
      active = false;
      clear();
    },
    poke() {
      void tick();
    },
    pause() {
      paused = true;
      clear();
    },
    resume() {
      if (!active) return;
      paused = false;
      if (running) return;
      const gap = options.resumeMinGapMs ?? 0;
      if (lastRunAt === null || now() - lastRunAt >= gap) void tick();
      else schedule();
    },
  };
}

/** Приложение на переднем плане. Неизвестное состояние при запуске считается передним планом. */
export function isForeground(status: string | null | undefined): boolean {
  return status !== "background" && status !== "inactive";
}
