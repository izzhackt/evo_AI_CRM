// Общие части экранов решения по документу и по комплекту: файл, проверка файла, время. Тексты берутся из общих словарей
// веба (`programDocuments`, пакетные `packageStrings`), как у страниц /portal/document-notifications и
// /portal/package-notifications; своих формулировок решений здесь нет.
import type { ApplicationDocumentFile, ApplicationDocumentReview, ApplicationDocumentSubmission } from "@web/lib/portal/application-documents";
import { View } from "react-native";

import { bishkekTime } from "@/features/inbox/format";
import { useLang } from "@/i18n/LangProvider";
import type { PortalStrings } from "@/i18n";
import { RpcError } from "@/lib/rpc";
import { sansFont } from "@/theme/fonts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export type ProgramDocumentStrings = PortalStrings<"programDocuments">;

/** Слово решения по файлу («Принят для этой программы», «Нужно исправить», «Не принят») или «Ожидает проверки EVO». */
export function reviewWord(review: Pick<ApplicationDocumentReview, "decision"> | null, docs: ProgramDocumentStrings): string {
  return review ? docs[`review.${review.decision}`] : docs.waitingReview;
}

/** Файл программы: имя, версия и, если он недоступен, понятные причины (веб ProgramFileEvidence без кнопки скачивания). */
export function FileEvidence({ file }: { file: ApplicationDocumentFile }) {
  const { t, format } = useLang();
  const docs = t("programDocuments");
  return (
    <View style={{ gap: 4 }} testID="file-evidence">
      <Text variant="body" selectable style={{ fontFamily: sansFont("medium") }}>
        {file.originalFilename}
      </Text>
      <Text variant="caption" tone="text2">
        {format(docs.version, { version: file.versionNo })}
      </Text>
      {file.technicalAvailability !== "available"
        ? file.unavailableReasons.map((reason) => (
            <Text key={reason} variant="secondary" tone="text2">
              {docs[`availability.${reason}` as keyof ProgramDocumentStrings] ?? docs.downloadFailed}
            </Text>
          ))
        : null}
    </View>
  );
}

/** Решение по файлу: слово, замечание сотрудника и время (веб ProgramSubmissionEvidence). */
export function ReviewLines({ review }: { review: ApplicationDocumentReview | null }) {
  const { t } = useLang();
  const docs = t("programDocuments");
  return (
    <View style={{ gap: 4 }}>
      <Text variant="body" bold testID="review-word">
        {reviewWord(review, docs)}
      </Text>
      {review?.reason ? (
        <Text variant="secondary" selectable testID="review-reason">
          {review.reason}
        </Text>
      ) : null}
      {review ? (
        <Text variant="caption" tone="text2">
          {docs.reviewedAt}: {bishkekTime(review.reviewedAt)}
        </Text>
      ) : null}
    </View>
  );
}

/** «Отправленный документ»: файл, время отправки и решение (веб ProgramSubmissionEvidence). */
export function SubmissionEvidence({ submission }: { submission: ApplicationDocumentSubmission }) {
  const { t } = useLang();
  const docs = t("programDocuments");
  return (
    <View style={{ gap: 8 }} testID="submission-evidence">
      <Text variant="body" bold accessibilityRole="header">
        {docs.submittedFile}
      </Text>
      <FileEvidence file={submission.file} />
      <Text variant="caption" tone="text2">
        {docs.submittedAt}: {bishkekTime(submission.submittedAt)}
      </Text>
      <ReviewLines review={submission.review} />
    </View>
  );
}

/**
 * Сервер ответил «нет доступа» (42501): такого уведомления у этого студента нет (чужое, несуществующее, не ответ куратора). Повтор
 * этого не изменит, поэтому экран говорит «не найдено» без «Повторить» (веб: `notFound()`), а не «не удалось, повторите».
 */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof RpcError && error.kind === "forbidden";
}

/** «Такой страницы здесь нет» (слова веба, как у экрана «страница не найдена»), без кнопки повтора. */
export function DetailNotFound() {
  const { m } = useLang();
  return (
    <Card>
      <View accessibilityRole="alert" style={{ gap: 4 }} testID="detail-not-found">
        <Text variant="body" bold accessibilityRole="header">
          {m("app.notFound.title")}
        </Text>
        <Text variant="secondary" tone="text2">
          {m("app.notFound.text")}
        </Text>
      </View>
    </Card>
  );
}
