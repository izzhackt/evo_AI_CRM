// Выбор страны пути (CountryTimeline.tsx -> CountryPicker, веб): шесть стран и «Пока не
// решил». Запись идёт через `useSaveCountryChoice`: повтор после сбоя шлёт тот же запрос.
import { Pressable, View } from "react-native";
import { Check } from "lucide-react-native";
import type { CountryChoiceSource } from "@web/lib/portal/country-choice";
import { timelineCountryOptions } from "@web/lib/portal/student-journey";

import { useLang } from "@/i18n/LangProvider";
import { useSaveCountryChoice } from "@/api/queries";
import { useTheme } from "@/theme/ThemeProvider";
import { Card } from "@/ui/Screen";
import { InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function CountryPicker({
  current,
  source = null,
  onDone,
  lead,
}: {
  current: string | null;
  /** Откуда выбор: тот же код, уже сохранённый студентом, повторно не пишется. */
  source?: CountryChoiceSource | null;
  onDone?: () => void;
  lead: string | null;
}) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const timeline = t("timeline");
  const save = useSaveCountryChoice();
  const saving = save.isPending ? save.variables : null;
  const options = timelineCountryOptions(lang);

  const choose = (code: string) => {
    if (save.isPending) return;
    if (code === current && source === "saved") {
      onDone?.();
      return;
    }
    save.mutate(code, { onSuccess: () => onDone?.() });
  };

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={timeline.choiceGroup} style={{ gap: 8 }}>
      {lead ? (
        <Text variant="secondary" tone="text2">
          {lead}
        </Text>
      ) : null}
      {options.map((option) => {
        const selected = option.code === current;
        const isSaving = option.code === saving;
        return (
          <Pressable
            key={option.code}
            testID={`country-${option.code}`}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled: save.isPending, busy: isSaving }}
            onPress={() => choose(option.code)}
            style={({ pressed }) => ({
              minHeight: MIN_TARGET + 4,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: tokens.radiusItem,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? tokens.accent : tokens.controlEdge,
              backgroundColor: tokens.surface,
              opacity: save.isPending && !isSaving ? 0.6 : 1,
              transform: [{ scale: pressed ? tokens.pressScale : 1 }],
            })}
          >
            <Text variant="body" bold={selected} style={{ flexShrink: 1 }}>
              {option.label}
            </Text>
            {isSaving ? (
              <Text variant="caption" tone="text2">
                {timeline.saving}
              </Text>
            ) : selected ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Check size={16} strokeWidth={2} color={tokens.accent} />
                <Text variant="caption" tone="accent" bold>
                  {timeline.current}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {save.isError ? <InlineAlert message={timeline.saveError} testID="country-save-error" /> : null}
    </View>
  );
}

/** Карточка выбора страны, пока страны нет (первый блок «Главной»). */
export function CountryChoiceCard({ readFailed, readFailedMessage }: { readFailed: boolean; readFailedMessage: string }) {
  const { t } = useLang();
  const timeline = t("timeline");
  return (
    <Card>
      <Text variant="heading" accessibilityRole="header">
        {timeline.chooseTitle}
      </Text>
      <Text variant="secondary" tone="text2">
        {timeline.chooseLead}
      </Text>
      {readFailed ? <InlineAlert message={readFailedMessage} testID="country-read-error" /> : null}
      <CountryPicker current={null} lead={null} />
    </Card>
  );
}
