import { View } from "react-native";
import type { TimelineStepProgress } from "@web/lib/portal/country-timeline";

import { useTheme } from "@/theme/ThemeProvider";

/** Полоса шагов пути (`.pt-journey-meter`): пройдено зелёным, текущий тёмным. Картинка к строке «Сейчас». */
export function JourneyMeter({ steps, progress }: { steps: readonly { id: string }[]; progress: Readonly<Record<string, TimelineStepProgress>> | null }) {
  const { tokens } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", gap: 3 }}>
      {steps.map((step) => {
        const state = progress?.[step.id] ?? "upcoming";
        return (
          <View
            key={step.id}
            testID={`meter-${state}`}
            style={{ flex: 1, height: 4, borderRadius: tokens.radiusChip, backgroundColor: state === "done" ? tokens.ok : state === "current" ? tokens.text : tokens.line }}
          />
        );
      })}
    </View>
  );
}
