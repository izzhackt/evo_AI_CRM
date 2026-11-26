// Срок документа: дата, время, пояс, «Срок проверен» и ссылка на источник (в браузере). Один и тот же блок у требования и у записи
// истории (веб: `Requirement` в `ApplicationRequirementsUI.tsx` и `ProgramHistoryEvidence`).
import type { ApplicationRequirementDeadline } from "@web/lib/portal/application-requirements-v2";
import { Linking, View } from "react-native";

import { dottedDate, materialDeadlineLine } from "@/features/preparations/model";
import { LinkButton } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function DeadlineBlock({ deadline, heading, verified, sourceLabel, testID }: {
  deadline: ApplicationRequirementDeadline;
  heading: string;
  verified: string;
  sourceLabel: string;
  testID?: string;
}) {
  return (
    <View style={{ gap: 2 }} testID={testID}>
      <Text variant="caption" tone="text2" bold>
        {heading}
      </Text>
      <Text variant="data">{materialDeadlineLine(deadline)}</Text>
      <Text variant="secondary" tone="text2">
        {verified} {dottedDate(deadline.verifiedOn)}
      </Text>
      {deadline.sourceUrl ? <LinkButton label={sourceLabel} onPress={() => void Linking.openURL(deadline.sourceUrl ?? "").catch(() => undefined)} testID={testID ? `${testID}-source` : undefined} /> : null}
    </View>
  );
}
