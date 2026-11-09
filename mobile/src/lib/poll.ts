// Планировщик опроса: следующий запуск ставится ПОСЛЕ завершения предыдущего, поэтому
// запросы не накладываются. Пауза и возобновление — для фона и скрытого экрана.
export type Poller = Readonly<{ start: () => void; stop: () => void; poke: () => void }>;

export function createPoller(options: Readonly<{ intervalMs: number; run: () => Promise<unknown> | unknown }>): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = false;
  let running = false;

  const schedule = () => {
    if (!active || timer !== null || running) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, options.intervalMs);
  };
  const tick = async () => {
    if (!active || running) return;
    running = true;
    try {
      await options.run();
    } catch {
      // сбой одного опроса не останавливает следующий
    } finally {
      running = false;
      schedule();
    }
  };
  return {
    start() {
      if (active) return;
      active = true;
      schedule();
    },
    stop() {
      active = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    /** Внеочередной запуск (например, после отправки): отсчёт начинается заново. */
    poke() {
      if (!active) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      void tick();
    },
  };
}

/** Приложение на переднем плане. Неизвестное состояние при запуске считается передним планом. */
export function isForeground(status: string | null | undefined): boolean {
  return status !== "background" && status !== "inactive";
}
