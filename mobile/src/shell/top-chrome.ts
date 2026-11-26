// Сколько экрана занимает всё, что кабинет держит над экранами в потоке: отступ безопасной зоны, верхняя полоса и, пока стоит, карточка
// «Не удалось обновить уведомления» (`shell/PollFailureNotice.tsx`). Экранам с клавиатурой (беседа, Эви) эта высота нужна как
// `keyboardVerticalOffset` на iPhone: без неё `KeyboardAvoidingView` ошибается на высоту карточки, пока она есть, и поле ввода
// остаётся под клавиатурой. Карточка сообщает свою высоту сюда после раскладки, экраны читают. Хранилище одно на приложение;
// после выхода из кабинета карточка размонтируется и сбрасывает его в 0.
import { useSyncExternalStore } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TOP_BAR_HEIGHT } from "@/shell/top-bar-metrics";

let noticeHeight = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Карточка сообщает высоту (pt) вместе с отступом под ней. Нечисло, 0 и отрицательное считаются «карточки нет» (0). */
export function reportTopNoticeHeight(next: number): void {
  const value = Number.isFinite(next) && next > 0 ? Math.round(next) : 0;
  if (value === noticeHeight) return;
  noticeHeight = value;
  for (const listener of [...listeners]) listener();
}

/** Отступ безопасной зоны + верхняя полоса + карточка сбоя опроса (если она сейчас стоит): расстояние от верха экрана до экранов. */
export function useTopChromeHeight(): number {
  const insets = useSafeAreaInsets();
  const notice = useSyncExternalStore(subscribe, () => noticeHeight, () => 0);
  return insets.top + TOP_BAR_HEIGHT + notice;
}
