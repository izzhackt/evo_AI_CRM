// `expo-router` для проверки охранников маршрутов корневого макета: рисуются только те `Stack.Screen`, чей `Stack.Protected` пропускает
// (`guard` истинен). Какой экран откроет приложение, видно по `testID="screen:<имя>"`; внутри стоит зонд сессии (`session-probe`).
import { Text, View, type ViewProps } from "react-native";

import { SessionProbe } from "@/test-fixtures/session-probe";

function Screen({ name }: { name: string }) {
  return <Text testID={`screen:${name}`}>{name}</Text>;
}

function Protected({ guard, children }: { guard: boolean; children?: ViewProps["children"] }) {
  return guard ? <>{children}</> : null;
}

export const Stack = Object.assign(
  ({ children }: { children?: ViewProps["children"] }) => (
    <View>
      <SessionProbe />
      {children}
    </View>
  ),
  { Screen, Protected },
);
