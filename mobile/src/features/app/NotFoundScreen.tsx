// «Такой страницы здесь нет» (G5 аудита паритета 25.11.2026; веб: src/app/(portal)/not-found.tsx): ссылка устарела или адрес
// введён неверно (например, evoadmissions://… на экран, которого нет). Раньше открывался английский экран expo-router «Unmatched
// Route». Тексты RU и KY из словаря приложения; кнопка ведёт на корневой маршрут, а он по состоянию сессии выбирает вход,
// шлюз или «Главную».
import { router } from "expo-router";
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function NotFoundScreen() {
  const { m } = useLang();
  return (
    <Screen>
      <View style={{ marginTop: 48 }} testID="not-found">
        <Card>
          <Text variant="caption" tone="text2" bold>
            {m("app.notFound.kicker")}
          </Text>
          <Text variant="title" accessibilityRole="header">
            {m("app.notFound.title")}
          </Text>
          <Text variant="body" tone="text2">
            {m("app.notFound.text")}
          </Text>
          <Button label={m("app.notFound.action")} onPress={() => router.replace("/")} testID="not-found-home" />
        </Card>
      </View>
    </Screen>
  );
}
