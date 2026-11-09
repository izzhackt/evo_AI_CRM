// Шапка «Главной» (HomeHero.tsx, веб #1412): тёмная плашка с красной кромкой и знаком EVO,
// приветствие по имени, страна поступления и дорожка этапов дела. На телефоне подписи шагов
// скрыты, вместо них строка «Этап N из M: …» (в вебе так же при узкой шапке).
import { View } from "react-native";

import { ADMISSION_STAGE_PATH, stageIndex, stageLabel } from "@/domain/presentation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { EvoMark } from "@/ui/EvoMark";
import { Text } from "@/ui/Text";

/** `rgb(255 255 255 / 0.05)` из токенов -> строка, понятная RN. */
function markColor(value: string): string {
  const match = /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/.exec(value);
  return match ? `rgba(${match[1]},${match[2]},${match[3]},${match[4]})` : value;
}

export function HomeHero({ displayName, studyCountry, stage }: { displayName: string; studyCountry: string | null; stage: string | null }) {
  const { t, m, format } = useLang();
  const { tokens } = useTheme();
  const home = t("home");
  const admission = t("admission");
  const label = stage ? stageLabel(stage, admission) : null;
  const index = stageIndex(stage);
  const total = ADMISSION_STAGE_PATH.length;
  // Этап с дорожкой подписан на ней; без дорожки словом под именем.
  const subline = [studyCountry, index >= 0 ? null : label].filter(Boolean).join(" · ");

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
        {subline ? (
          <Text variant="secondary" style={{ color: tokens.heroMuted }} bold>
            {subline}
          </Text>
        ) : null}
      </View>
      {index >= 0 && label ? (
        <View style={{ borderTopWidth: 1, borderTopColor: tokens.heroLine, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18, gap: 14 }}>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${home.stagesAria}. ${format(m("timeline.stageTrackLabel"), { n: String(index + 1), total: String(total), stage: label })}`}
            accessibilityValue={{ min: 1, max: total, now: index + 1 }}
            testID="stage-track"
            style={{ flexDirection: "row" }}
          >
            {ADMISSION_STAGE_PATH.map((key, position) => {
              const done = position < index;
              const current = position === index;
              return (
                <View key={key} style={{ flex: 1, alignItems: "center", justifyContent: "center", height: 18 }} testID={`stage-${current ? "current" : done ? "done" : "upcoming"}`}>
                  {position > 0 ? <View style={{ position: "absolute", right: "50%", width: "100%", height: 2, backgroundColor: done || current ? tokens.heroMuted : tokens.heroLine }} /> : null}
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: done ? tokens.heroMuted : tokens.heroBg,
                      borderWidth: done ? 0 : current ? 2 : 1.5,
                      borderColor: current ? tokens.heroInk : tokens.heroRing,
                    }}
                  >
                    {current ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.brandRed }} /> : null}
                  </View>
                </View>
              );
            })}
          </View>
          <Text variant="secondary" bold style={{ color: tokens.heroInk }} accessibilityElementsHidden importantForAccessibility="no">
            {format(home.stageStep, { n: String(index + 1), total: String(total), stage: label })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
