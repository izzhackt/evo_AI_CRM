// Проверка обновления при возврате на передний план (рецензия #1568, низкая находка 1а).
// `useUpdates()` сам ничего не проверяет и не скачивает: он только показывает состояние. `checkAutomatically: ON_LOAD` проверяет
// обновление при запуске, а студент, у которого приложение живёт днями (сворачивается и возвращается), новой версии не увидит.
// Поэтому при каждом возврате на передний план (`AppState` «active») приложение само спрашивает EAS Update, но не чаще раза в
// час (документация expo-updates: проверять при запуске и выходе на передний план, не опрашивать в цикле; сервер Expo может
// ограничивать частоту), только когда обновления включены (не разработка и не Expo Go), и без собственного интерфейса: скачанное
// обновление показывает уже существующая карточка «Вышла новая версия». Любой сбой молча проглатывается: проверка необязательна.
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState } from "react-native";

/** Не чаще раза в час. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export type UpdateCheckOutcome = "skipped" | "none" | "downloaded" | "failed";

export type UpdateCheckDeps = Readonly<{
  now: () => number;
  isEnabled: () => boolean;
  check: () => Promise<{ isAvailable: boolean }>;
  fetch: () => Promise<unknown>;
}>;

const REAL_DEPS: UpdateCheckDeps = {
  now: () => Date.now(),
  isEnabled: () => Updates.isEnabled,
  check: () => Updates.checkForUpdateAsync(),
  fetch: () => Updates.fetchUpdateAsync(),
};

/**
 * Проверяльщик «при возврате на передний план». Запуск приложения считается проверкой (её делает сам `ON_LOAD`), поэтому первая
 * проверка возможна не раньше чем через `intervalMs` после создания. Время пробы, а не успеха, ограничивает частоту: сбой не
 * разрешает бить в сервер чаще. Параллельно идёт не больше одной проверки.
 */
export function createForegroundUpdateChecker(deps: UpdateCheckDeps = REAL_DEPS, intervalMs: number = UPDATE_CHECK_INTERVAL_MS): () => Promise<UpdateCheckOutcome> {
  let lastAttemptAt = deps.now();
  let running = false;
  return async () => {
    if (running) return "skipped";
    try {
      if (!deps.isEnabled()) return "skipped";
      const now = deps.now();
      // Часы ушли назад: разность отрицательна, значит «рано»; ждём, пока они догонят, а не проверяем при каждом возврате.
      if (now - lastAttemptAt < intervalMs) return "skipped";
      lastAttemptAt = now;
      running = true;
      const result = await deps.check();
      if (!result.isAvailable) return "none";
      await deps.fetch();
      return "downloaded";
    } catch {
      return "failed";
    } finally {
      running = false;
    }
  };
}

/** Подписка на возврат на передний план. Ставится внутри предохранителя карточки обновления. */
export function useForegroundUpdateCheck(): void {
  useEffect(() => {
    const run = createForegroundUpdateChecker();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") void run();
    });
    return () => subscription.remove();
  }, []);
}
