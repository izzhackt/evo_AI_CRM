// «Уменьшить движение» в системе (iOS: Reduce Motion, Android: «Удалить анимации»). Живой Эви и бегущие точки при нём стоят: лицо
// и подпись меняются сразу, ничто не зацикливается (контракт кабинета, «Исключения 17.11.2026», как `prefers-reduced-motion` веба).
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Включено ли «уменьшить движение»; пока система не ответила, считается выключенным, смена настройки подхватывается на лету. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduce(on);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => setReduce(on));
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}
