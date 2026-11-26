// Шапка программы: вуз, программа, набор, статус, пояснение «заявка в университет не отправляется», срок подачи набора.
// Веб: `<header className="pt-page-header">` в `portal/preparations/[applicationId]/page.tsx`.
import { View } from "react-native";

import type { CatalogPreparation } from "@web/lib/portal/catalog-preparations";
import type { PortalStrings } from "@web/lib/portal/i18n";

import { intakeDeadlineLine, selectedProgramOf } from "@/features/preparations/model";
import type { Lang } from "@/i18n";
import { Text } from "@/ui/Text";

export function PreparationHeader({ saved, strings, universityStrings, lang }: {
  saved: CatalogPreparation;
  strings: PortalStrings<"preparations">;
  universityStrings: PortalStrings<"universities">;
  lang: Lang;
}) {
  const { program, intake } = selectedProgramOf(saved);
  const deadline = intake ? intakeDeadlineLine(intake, lang) : null;
  return (
    <View style={{ gap: 6 }} testID="prep-header">
      <Text variant="caption" tone="text2" testID="prep-university">
        {saved.content.name}
      </Text>
      <Text variant="title" accessibilityRole="header" testID="prep-title">
        {program?.title ?? saved.content.name}
      </Text>
      {intake ? (
        <Text variant="body" tone="text2" testID="prep-intake">
          {intake.label}
        </Text>
      ) : null}
      <Text variant="secondary" bold testID="prep-status">
        {strings[`status.${saved.applicationStatus}`]}
      </Text>
      <Text variant="secondary" tone="text2">
        {strings.saved}
      </Text>
      <Text variant="secondary" tone="text2">
        {strings.savedFacts}
      </Text>
      {deadline ? (
        <View style={{ gap: 2, marginTop: 4 }} testID="prep-intake-deadline">
          <Text variant="caption" tone="text2" bold>
            {universityStrings.intakeDeadline}
          </Text>
          <Text variant="data">{deadline}</Text>
        </View>
      ) : null}
      {saved.deadlineStateAtSelection === "needs_confirmation" ? (
        <Text variant="secondary" tone="text2" testID="prep-saved-deadline">
          {strings.savedDeadline}
        </Text>
      ) : null}
    </View>
  );
}
