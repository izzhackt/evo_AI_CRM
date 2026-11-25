// Одно требование программы: название, «Обязательно / Необязательно», группа, инструкция, срок документа и состояние файла.
// Веб: `Requirement` в `ApplicationRequirementsUI.tsx` (+ `ProgramDocumentItem`, его действия добавляет следующий PR).
import { Linking, View } from "react-native";

import type { ApplicationDocumentItemState } from "@web/lib/portal/application-documents";
import type { PortalStrings } from "@web/lib/portal/i18n";
import type { ApplicationRequirementItemV2 } from "@web/lib/portal/application-requirements-v2";

import { ItemDocumentState } from "@/features/preparations/ItemDocumentState";
import { associationReasons, dottedDate, materialDeadlineLine } from "@/features/preparations/model";
import { useLang } from "@/i18n/LangProvider";
import { LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

export function RequirementCard({ item, state, strings, documentStrings }: {
  item: ApplicationRequirementItemV2;
  state: ApplicationDocumentItemState;
  strings: PortalStrings<"preparations">;
  documentStrings: PortalStrings<"programDocuments">;
}) {
  const { m } = useLang();
  const unavailable = associationReasons(item);
  const { deadline } = item;
  return (
    <Card>
      <View style={{ gap: 8 }} testID={`prep-requirement-${item.requirementItemId}`}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            {item.label}
          </Text>
          <StatusPill label={item.required ? strings.required : strings.optional} tone="neutral" />
        </View>
        <Text variant="caption" tone="text2">
          {item.groupLabel}
        </Text>
        <Text variant="body">{item.instructions}</Text>
        {item.definitionImpact === "changed" ? (
          <Text variant="secondary" tone="text2" testID={`prep-changed-${item.requirementItemId}`}>
            {strings.definitionChanged}
          </Text>
        ) : null}
        {deadline ? (
          <View style={{ gap: 2 }} testID={`prep-deadline-${item.requirementItemId}`}>
            <Text variant="caption" tone="text2" bold>
              {strings.materialDeadline}
            </Text>
            <Text variant="data">{materialDeadlineLine(deadline)}</Text>
            <Text variant="secondary" tone="text2">
              {strings.deadlineVerified} {dottedDate(deadline.verifiedOn)}
            </Text>
            {deadline.sourceUrl ? (
              <LinkButton
                label={m("prep.deadlineSource")}
                onPress={() => void Linking.openURL(deadline.sourceUrl ?? "").catch(() => undefined)}
                testID={`prep-deadline-source-${item.requirementItemId}`}
              />
            ) : null}
          </View>
        ) : null}
        {unavailable.length > 0 ? (
          <View style={{ gap: 2 }}>
            <Text variant="caption" tone="text2" bold>
              {strings.file}
            </Text>
            {unavailable.map((reason) => (
              <Text key={reason} variant="secondary">
                {strings[`technical.${reason}`]}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      <ItemDocumentState state={state} strings={documentStrings} testID={`prep-document-${item.requirementItemId}`} />
    </Card>
  );
}
