// Ссылка наружу (сайт вуза, источник, страница программы). Цель нажатия не меньше 44 pt: прежняя «текст с onPress» была
// около 36 pt (аудит паритета 25.11.2026, G44). Занимает ширину текста, а не строки, чтобы случайно не нажиматься рядом с ним.
import { Linking, Pressable } from "react-native";

import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function ExternalLink({ url, label, testID }: { url: string; label: string; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      testID={testID}
      style={{ minHeight: MIN_TARGET, justifyContent: "center", alignSelf: "flex-start" }}
    >
      <Text variant="secondary" tone="accent" bold>
        {label}
      </Text>
    </Pressable>
  );
}
