// Ссылка наружу (сайт вуза, источник, страница программы). Вынесена из UniversityScreen.tsx без изменений.
import { Linking } from "react-native";

import { Text } from "@/ui/Text";

export function ExternalLink({ url, label }: { url: string; label: string }) {
  return (
    <Text variant="secondary" tone="accent" bold accessibilityRole="link" onPress={() => void Linking.openURL(url).catch(() => undefined)} style={{ paddingVertical: 8 }}>
      {label}
    </Text>
  );
}
