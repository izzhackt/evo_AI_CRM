// Файл документа программы глазами студента: имя, версия, причины недоступности и «Скачать файл»; отправленный документ с
// временем по Бишкеку и решением EVO. Веб: `ProgramDocumentEvidence.tsx` (`ProgramFileEvidence`, `ProgramSubmissionEvidence`).
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { View } from "react-native";

import type { ApplicationDocumentFile, ApplicationDocumentItemTarget, ApplicationDocumentSubmission } from "@web/lib/portal/application-documents";
import { formatPortalString } from "@web/lib/portal/i18n";

import { usePortalApi } from "@/api/PortalApi";
import { downloadApplicationFile } from "@/features/preparations/download";
import type { DocumentStrings } from "@/features/preparations/document-strings";
import { availabilityText, programTime } from "@/features/preparations/model";
import { usePreparation } from "@/features/preparations/context";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { InlineAlert } from "@/ui/CardParts";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

/** «Скачать файл»: два шага через портал и хранилище, потом открытие системным просмотром. Ошибка словами, без текста сервера. */
function DownloadButton({ file, target, testID }: { file: ApplicationDocumentFile; target: ApplicationDocumentItemTarget; testID?: string }) {
  const { io, strings } = usePreparation();
  const api = usePortalApi();
  const { format, m } = useLang();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const result = await downloadApplicationFile(io.createDownloadDeps(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), target, file.documentVersionId, file.originalFilename, file.declaredMimeType);
      if (!result.ok) setFailed(true);
      else await io.openLocalFile(result.uri, file.declaredMimeType);
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 6 }}>
      <Button
        variant="ghost"
        label={busy ? strings.downloading : strings.download}
        accessibilityLabel={format(m("prep.downloadAria"), { name: file.originalFilename })}
        busy={busy}
        disabled={file.technicalAvailability !== "available"}
        onPress={() => void download()}
        testID={testID}
      />
      {failed ? <InlineAlert message={strings.downloadFailed} testID={testID ? `${testID}-error` : undefined} /> : null}
    </View>
  );
}

/** Имя файла, версия, причины недоступности; при `target` ещё и «Скачать файл». */
export function FileFacts({ file, strings, target, testID }: { file: ApplicationDocumentFile; strings: DocumentStrings; target?: ApplicationDocumentItemTarget; testID?: string }) {
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
      {target ? <DownloadButton file={file} target={target} testID={testID ? `${testID}-download` : undefined} /> : null}
    </View>
  );
}

/** Решение EVO по версии файла словом; цвет только подкрепляет слово. */
function decisionTone(decision: NonNullable<ApplicationDocumentSubmission["review"]>["decision"]) {
  return decision === "approved" ? "ok" : decision === "correction_required" ? "warn" : "danger";
}

export function Block({ heading, children, testID }: { heading: string; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: 6 }} testID={testID}>
      <Text variant="body" bold accessibilityRole="header">
        {heading}
      </Text>
      {children}
    </View>
  );
}

/** Отправленный документ: файл, когда отправлен, решение EVO, замечание сотрудника, когда проверен. */
export function SubmissionFacts({ submission, strings, target, testID }: { submission: ApplicationDocumentSubmission; strings: DocumentStrings; target?: ApplicationDocumentItemTarget; testID?: string }) {
  const { review } = submission;
  const origin = target ? { ...target, requirementsRevisionId: submission.requirementsRevisionId, requirementItemId: submission.requirementItemId, documentSlotId: submission.documentSlotId } : undefined;
  return (
    <Block heading={strings.submittedFile} testID={testID}>
      <FileFacts file={submission.file} strings={strings} target={origin} testID={testID ? `${testID}-file` : undefined} />
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
