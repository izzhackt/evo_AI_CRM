// Что сейчас с файлом у одного требования программы, только чтение: сохранённый, но не отправленный файл,
// отправленный документ и решение EVO. Веб: `ProgramDocumentItem.tsx` (блок «Сохранён, ещё не отправлен») и
// `ProgramDocumentEvidence.tsx` (`ProgramSubmissionEvidence`). Действия над файлом (загрузить, отправить, скачать)
// добавляет следующий PR этого среза в том же месте.
import type { ReactNode } from "react";
import { View } from "react-native";

import type { ApplicationDocumentFile, ApplicationDocumentItemState, ApplicationDocumentSubmission } from "@web/lib/portal/application-documents";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";

import { availabilityText, itemDocumentView, programTime } from "@/features/preparations/model";
import { useTheme } from "@/theme/ThemeProvider";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

type DocumentStrings = PortalStrings<"programDocuments">;

/** Имя файла, версия и, если файл недоступен, понятная причина каждой строкой (`ProgramFileEvidence`). */
export function FileFacts({ file, strings, testID }: { file: ApplicationDocumentFile; strings: DocumentStrings; testID?: string }) {
  return (
    <View style={{ gap: 2 }} testID={testID}>
      <Text variant="body" bold>
        {file.originalFilename}
      </Text>
      <Text variant="caption" tone="text2">
        {formatPortalString(strings.version, { version: file.versionNo })}
      </Text>
      {file.technicalAvailability !== "available"
        ? file.unavailableReasons.map((reason) => (
            <Text key={reason} variant="secondary" tone="text2">
              {availabilityText(strings, reason)}
            </Text>
          ))
        : null}
    </View>
  );
}

/** Решение EVO по версии файла словом; цвет только подкрепляет слово. */
function decisionTone(decision: NonNullable<ApplicationDocumentSubmission["review"]>["decision"]) {
  return decision === "approved" ? "ok" : decision === "correction_required" ? "warn" : "danger";
}

function Block({ heading, children, testID }: { heading: string; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: 6 }} testID={testID}>
      <Text variant="body" bold accessibilityRole="header">
        {heading}
      </Text>
      {children}
    </View>
  );
}

export function SubmissionFacts({ submission, strings, testID }: { submission: ApplicationDocumentSubmission; strings: DocumentStrings; testID?: string }) {
  const { review } = submission;
  return (
    <Block heading={strings.submittedFile} testID={testID}>
      <FileFacts file={submission.file} strings={strings} />
      <Text variant="secondary" tone="text2">
        {strings.submittedAt}: <Text variant="data">{programTime(submission.submittedAt)}</Text>
      </Text>
      <StatusPill label={review ? strings[`review.${review.decision}`] : strings.waitingReview} tone={review ? decisionTone(review.decision) : "neutral"} testID={testID ? `${testID}-decision` : undefined} />
      {review?.reason ? <Text variant="body">{review.reason}</Text> : null}
      {review ? (
        <Text variant="secondary" tone="text2">
          {strings.reviewedAt}: <Text variant="data">{programTime(review.reviewedAt)}</Text>
        </Text>
      ) : null}
    </Block>
  );
}

export function ItemDocumentState({ state, strings, testID }: { state: Pick<ApplicationDocumentItemState, "savedDraft" | "submission">; strings: DocumentStrings; testID?: string }) {
  const { tokens } = useTheme();
  const view = itemDocumentView(state);
  return (
    <View style={{ gap: 12, borderTopWidth: 1, borderTopColor: tokens.line, paddingTop: 12 }} testID={testID}>
      {view.unsubmittedDraft ? (
        <Block heading={strings.savedOnly} testID={testID ? `${testID}-draft` : undefined}>
          <FileFacts file={view.unsubmittedDraft.file} strings={strings} />
          {view.newerDraft ? (
            <Text variant="secondary" tone="text2">
              {strings.newDraftHint}
            </Text>
          ) : null}
        </Block>
      ) : view.noFile ? (
        <Text variant="secondary" tone="text2">
          {strings.noFile}
        </Text>
      ) : null}
      {view.submission ? <SubmissionFacts submission={view.submission} strings={strings} testID={testID ? `${testID}-submission` : undefined} /> : null}
    </View>
  );
}
