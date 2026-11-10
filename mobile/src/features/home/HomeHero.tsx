// Шапка «Главной» (HomeHero.tsx, веб #1412): тёмная плашка с красной кромкой и знаком EVO, приветствие по имени и
// страна поступления. Дорожка десяти этапов EVO снята (10.11.2026): где студент, говорит одна полоса «Шаг N из M»
// по пути страны (JourneyCard).
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { EvoMark } from "@/ui/EvoMark";
import { Text } from "@/ui/Text";

/** `rgb(255 255 255 / 0.05)` из токенов -> строка, понятная RN. */
function markColor(value: string): string {
  const match = /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/.exec(value);
  return match ? `rgba(${match[1]},${match[2]},${match[3]},${match[4]})` : value;
}

export function HomeHero({ displayName, studyCountry }: { displayName: string; studyCountry: string | null }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const home = t("home");

  return (
    <View
      testID="home-hero"
      style={{ overflow: "hidden", borderTopWidth: 3, borderTopColor: tokens.brandRed, borderRadius: tokens.radiusCard, backgroundColor: tokens.heroBg }}
    >
      <View pointerEvents="none" style={{ position: "absolute", top: -36, right: -40 }}>
        <EvoMark size={240} color={markColor(tokens.heroMark)} />
      </View>
      <View style={{ gap: 8, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 }}>
        <Text variant="title" maxFontSizeMultiplier={1.2} accessibilityRole="header" style={{ color: tokens.heroInk, fontSize: 28, lineHeight: 33 }}>
          {format(home.greeting, { name: displayName })}
        </Text>
        {studyCountry ? (
          <Text variant="secondary" style={{ color: tokens.heroMuted }} bold>
            {studyCountry}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
