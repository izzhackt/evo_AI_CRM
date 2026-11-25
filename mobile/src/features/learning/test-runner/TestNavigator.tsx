// Навигатор по заданиям теста на время (веб: `nav.cs-navigator` в TimedTestRunner.tsx): сетка номеров всегда на виду над
// заданием, а не в окне по нажатию. Отвеченное закрашено, текущее в кольце цвета действия, отмеченное «Вернуться позже»
// с флажком на углу (раньше только рамка, хотя пояснение показывало флажок). Читалка слышит «Задание 5, отвечено, вернуться
// позже» и признак текущего; ячейка 44 pt.
import { Flag } from "lucide-react-native";
import { Pressable, View } from "react-native";

import type { CscaTestAttempt } from "@web/lib/portal/csca";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";

import { useLang } from "@/i18n/LangProvider";
import { monoFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Подпись ячейки для читалки: «Задание 5, отвечено, вернуться позже» (веб: `parts.join(", ")`). */
export function navCellLabel(index: number, answered: boolean, flagged: boolean, strings: PortalStrings<"csca">): string {
  return [formatPortalString(strings.navItem, { n: String(index + 1) }), answered ? strings.navAnswered : strings.navUnanswered, ...(flagged ? [strings.navFlagged] : [])].join(", ");
}

export function TestNavigator({
  attempt,
  answers,
  flags,
  index,
  disabled,
  onPick,
}: {
  attempt: Pick<CscaTestAttempt, "items">;
  answers: Readonly<Record<string, string>>;
  flags: readonly string[];
  index: number;
  disabled: boolean;
  onPick: (index: number) => void;
}) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  return (
    <View accessibilityRole="list" accessibilityLabel={c.navigatorLabel} style={{ gap: 8 }} testID="test-navigator">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {attempt.items.map((entry, i) => {
          const answered = entry.itemKey in answers;
          const flagged = flags.includes(entry.itemKey);
          const current = i === index;
          return (
            <Pressable
              key={entry.itemKey}
              accessibilityRole="button"
              accessibilityLabel={navCellLabel(i, answered, flagged, c)}
              accessibilityState={{ selected: current, disabled }}
              disabled={disabled}
              onPress={() => onPick(i)}
              testID={`nav-${i + 1}`}
              style={{
                width: MIN_TARGET,
                height: MIN_TARGET,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: tokens.radiusControl,
                borderWidth: 1,
                borderColor: answered ? tokens.text : tokens.controlEdge,
                backgroundColor: answered ? tokens.text : tokens.surface,
                // Текущее в кольце цвета действия на подложке страницы, как `box-shadow` веба.
                boxShadow: current ? `0 0 0 2px ${tokens.bg}, 0 0 0 4px ${tokens.accent}` : undefined,
              }}
            >
              <Text variant="secondary" bold importantForAccessibility="no" style={{ fontFamily: monoFont("bold"), color: answered ? tokens.surface : tokens.text }}>
                {i + 1}
              </Text>
              {flagged ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  testID={`nav-flag-${i + 1}`}
                  style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: tokens.warn, alignItems: "center", justifyContent: "center" }}
                >
                  <Flag size={11} strokeWidth={2} color={tokens.surface} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 18, rowGap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: tokens.text }} />
          <Text variant="caption" tone="text2">
            {c.legendAnswered}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Flag size={14} strokeWidth={2} color={tokens.warn} />
          <Text variant="caption" tone="text2">
            {c.legendFlagged}
          </Text>
        </View>
      </View>
    </View>
  );
}
