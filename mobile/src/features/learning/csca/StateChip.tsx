// Состояние темы CSCA: слово с точкой цвета и полоса тем модуля (веб: components/portal/csca/StateChip.tsx).
// Состояние всегда названо словом; цвет только подкрепляет слово (контракт §12).
import { View } from "react-native";

import type { CscaTopicState } from "@web/lib/portal/csca";

import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme, type Tokens } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

/** Цвет точки и клетки полосы: как `--cs-state-*` в csca.css (`few_data` держится на краю контрола). */
export function stateColor(state: CscaTopicState, tokens: Tokens): string {
  switch (state) {
    case "confident":
      return tokens.ok;
    case "shaky":
      return tokens.warn;
    case "gap":
      return tokens.error;
    case "few_data":
      return tokens.controlEdge;
    case "not_started":
      return tokens.line;
  }
}

/** Слово состояния с точкой. «Не начато» тише остальных, как на вебе. */
export function StateChip({ state, testID }: { state: CscaTopicState; testID?: string }) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const quiet = state === "not_started";
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: stateColor(state, tokens), borderWidth: 1, borderColor: tokens.line }}
      />
      <Text variant="caption" tone={quiet ? "text2" : "text"} style={{ fontFamily: sansFont(quiet ? "regular" : "medium") }}>
        {t("csca")[`state.${state}`]}
      </Text>
    </View>
  );
}

/** Полоса тем модуля: клетка на тему. Слова рядом, полоса только для взгляда (для читалки скрыта). */
export function TopicStrip({ states }: { states: readonly CscaTopicState[] }) {
  const { tokens } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", flexWrap: "wrap", gap: 3, maxWidth: 220 }}>
      {states.map((state, index) => (
        <View key={index} testID={`strip-${state}`} style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: stateColor(state, tokens) }} />
      ))}
    </View>
  );
}
