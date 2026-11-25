// Выставляет тесту контекст настоящего `SessionProvider` (вход, выход, состояние) и показывает состояние текстом.
import { useEffect } from "react";
import { Text } from "react-native";

import { useSession } from "@/session/SessionProvider";

/** Ячейка вместо присваивания переменной в рендере (правило react-hooks/globals). */
export const sessionProbe: { current: ReturnType<typeof useSession> | null } = { current: null };

export function SessionProbe() {
  const value = useSession();
  useEffect(() => {
    sessionProbe.current = value;
  });
  return <Text testID="session-probe">{`${value.state.kind}|${value.mustSetPassword ? "must" : "free"}|${value.ready ? "ready" : "wait"}`}</Text>;
}
