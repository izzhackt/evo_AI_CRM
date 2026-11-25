import { View } from "react-native";
import type { TimelineStepProgress } from "@web/lib/portal/country-timeline";

import { useTheme } from "@/theme/ThemeProvider";
import { GrowX } from "@/ui/motion";

/**
 * Полоса шагов пути (`.pt-journey-meter`, веб с 19.11.2026: 6 px, промежуток 4): пройдено зелёным, текущий тёмным.
 * Картинка к строке «Шаг N из M»; при первом показе один раз вырастает слева направо (`pt-fill-grow`).
 */
export function JourneyMeter({ steps, progress }: { steps: readonly { id: string }[]; progress: Readonly<Record<string, TimelineStepProgress>> | null }) {
  const { tokens } = useTheme();
  return (
    <GrowX testID="journey-meter">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", gap: 4 }}>
        {steps.filter((step) => progress?.[step.id] !== "optional").map((step) => {
          const state = progress?.[step.id] ?? "upcoming";
          return (
            <View
              key={step.id}
              testID={`meter-${state}`}
              style={{ flex: 1, height: 6, borderRadius: tokens.radiusChip, backgroundColor: state === "done" ? tokens.ok : state === "current" ? tokens.text : tokens.line }}
            />
          );
        })}
      </View>
    </GrowX>
  );
}
