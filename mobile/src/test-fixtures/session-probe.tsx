// Выставляет тесту контекст настоящего `SessionProvider` (вход, выход, состояние) и показывает состояние текстом.
import { useEffect } from "react";
import { Text } from "react-native";

import { useSession } from "@/session/SessionProvider";

/** Ячейка вместо присваивания переменной в рендере (правило react-hooks/globals). */
export const sessionProbe: { current: ReturnType<typeof useSession> | null } = { current: null };
/** Какие состояния сессии были нарисованы по порядку (подряд одинаковые склеены): видно, мелькало ли «Проверяем доступ…». */
export const sessionHistory: string[] = [];

export function SessionProbe() {
  const value = useSession();
  useEffect(() => {
    sessionProbe.current = value;
    if (sessionHistory.at(-1) !== value.state.kind) sessionHistory.push(value.state.kind);
  });
  return <Text testID="session-probe">{`${value.state.kind}|${value.mustSetPassword ? "must" : "free"}|${value.ready ? "ready" : "wait"}`}</Text>;
}
