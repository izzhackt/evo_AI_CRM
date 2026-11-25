// Планировщик опроса: следующий запуск ставится ПОСЛЕ завершения предыдущего, поэтому
// запросы не накладываются. Пауза и возобновление — для фона и скрытого экрана.
//
// Как у лёгкого опроса веба (`src/lib/light-poll.ts`, A4): запуск, который бросил исключение, считается сбоем, и пока сбои идут
// подряд, задержка до следующего растёт (`delayAfterFailures`); первый успех возвращает обычный интервал. Возврат из фона
// опрашивает сразу, только если прошлый запуск начался не меньше чем `resumeMinGapMs` назад (веб RESUME_MIN_GAP_MS), иначе
// просто ставит обычный отсчёт: частые переключения приложений не засыпают сервер запросами.
// Отличие от веба (разбор PR #1565): внеочередной запуск по действию студента (`poke`: «Повторить», смена раздела, «прочитано»)
// сбоем для расписания не считается. Иначе несколько нажатий «Повторить» без связи раздували бы задержку до десяти минут,
// хотя самих опросов по расписанию не было. Успех такого запуска, как и любой другой, возвращает обычный интервал.
export type Poller = Readonly<{
  /** Начать отсчёт; `immediate` - первый запуск сразу (он считается запуском по расписанию, сбой удлинит задержку). */
  start: (options?: Readonly<{ immediate?: boolean }>) => void;
  stop: () => void;
  /** Внеочередной запуск по действию студента (после отправки, смены раздела, кнопки «Повторить»): отсчёт начинается заново, сбой в счёт задержки не идёт. */
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
      void tick(true);
    }, delay);
  };
  /** `scheduled`: запуск по расписанию (таймер, первый запуск, возврат из фона); внеочередной (`poke`) сбоем для задержки не считается. */
  const tick = async (scheduled: boolean) => {
    if (!active || paused || running) return;
    clear();
    running = true;
    lastRunAt = now();
    try {
      await options.run();
      failures = 0;
    } catch {
      // сбой одного опроса не останавливает следующий; запуск по расписанию удлиняет задержку (если она задана)
      if (scheduled) failures += 1;
    } finally {
      running = false;
      schedule();
    }
  };
  return {
    start(startOptions) {
      if (active) return;
      active = true;
      paused = false;
      failures = 0;
      if (startOptions?.immediate) void tick(true);
      else schedule();
    },
    stop() {
      active = false;
      clear();
    },
    poke() {
      void tick(false);
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
      if (lastRunAt === null || now() - lastRunAt >= gap) void tick(true);
      else schedule();
    },
  };
}

/** Приложение на переднем плане. Неизвестное состояние при запуске считается передним планом. */
export function isForeground(status: string | null | undefined): boolean {
  return status !== "background" && status !== "inactive";
}
