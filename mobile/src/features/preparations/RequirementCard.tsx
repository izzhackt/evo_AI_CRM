// Одно требование программы: название, «Обязательно / Необязательно», группа, инструкция, срок документа, причины недоступной
// связи и документ (файл, загрузка, отправка, решение, история). Веб: `Requirement` в `ApplicationRequirementsUI.tsx`.
import { View } from "react-native";

import type { ApplicationDocumentItemState } from "@web/lib/portal/application-documents";
import type { PortalStrings } from "@web/lib/portal/i18n";
import type { ApplicationRequirementItemV2 } from "@web/lib/portal/application-requirements-v2";

import { DeadlineBlock } from "@/features/preparations/DeadlineBlock";
import { DocumentItem } from "@/features/preparations/DocumentItem";
import { usePreparation } from "@/features/preparations/context";
import { associationReasons } from "@/features/preparations/model";
import { Card } from "@/ui/Screen";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

export function RequirementCard({ item, state, revisionId, strings }: {
  item: ApplicationRequirementItemV2;
  state: ApplicationDocumentItemState;
  /** Ревизия требований, по которой читался этот ответ: к ней привязаны загрузка и отправка. */
  revisionId: string;
  strings: PortalStrings<"preparations">;
}) {
  const { scope, strings: documentStrings } = usePreparation();
  const unavailable = associationReasons(item);
  const { deadline } = item;
  const target = { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementsRevisionId: revisionId, requirementItemId: item.requirementItemId, documentSlotId: item.documentSlotId };
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
        {deadline ? <DeadlineBlock deadline={deadline} heading={strings.materialDeadline} verified={strings.deadlineVerified} sourceLabel={documentStrings.deadlineSource} testID={`prep-deadline-${item.requirementItemId}`} /> : null}
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
      <DocumentItem label={item.label} state={state} target={target} />
    </Card>
  );
}
