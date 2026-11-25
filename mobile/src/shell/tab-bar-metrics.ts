// Высота нижней панели вкладок, как её нарисовала система. Панель (TabBar) и плавающая кнопка «Написать EVO» (ChatFab) - соседи в
// оболочке и не знают друг о друге, а кнопка должна стоять над панелью с запасом при любой высоте панели (крупный шрифт, другая
// раскладка вкладок), иначе она ляжет на панель и закроет кружок «Входящих». Панель сообщает свою высоту сюда после раскладки,
// кнопка читает. Хранилище одно на приложение; после выхода из кабинета панель размонтируется и сбрасывает его в 0.
import { useSyncExternalStore } from "react";

let height = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Панель сообщает высоту (pt). Нечисло, 0 и отрицательное считаются «неизвестно» (0): кнопка берёт обычную высоту. */
export function reportTabBarHeight(next: number): void {
  const value = Number.isFinite(next) && next > 0 ? Math.round(next) : 0;
  if (value === height) return;
  height = value;
  for (const listener of [...listeners]) listener();
}

/** Измеренная высота панели вкладок; 0, пока панели нет или она ещё не раскладывалась. */
export function useMeasuredTabBarHeight(): number {
  return useSyncExternalStore(subscribe, () => height, () => 0);
}
