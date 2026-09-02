"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Card, btnCls, btnGhostCls, cn, inputCls, labelCls } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import { reviewPlatformDocumentVersionAction } from "@/lib/platform-private-document-actions";
import type {
  PlatformCaseDocumentWorkspace,
  PlatformDocumentVersion,
} from "@/lib/platform-private-documents";

const ACCEPTED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_BYTES = 25 * 1024 * 1024;

type Submission = Readonly<{
  slotId: string;
  status: "idle" | "sending" | "saved" | "error";
  message?: string;
}>;

export type PlatformDocumentRequestIds = Readonly<{
  uploadBySlot: Readonly<Record<string, string>>;
  reviewByVersion: Readonly<Record<string, string>>;
}>;

export type PlatformDocumentReviewFeedback = Readonly<{
  outcome: "saved" | "invalid" | "unavailable";
  subjectId: string | null;
}>;

const COPY = {
  ru: {
    title: "Приватные документы",
    description:
      "Каждая строка — требование к документу. Файлы сохраняются в приватном Supabase Storage, а повторная отправка создаёт новую неизменяемую версию.",
    required: "Требование",
    deadline: "Срок",
    nextAction: "Следующее действие",
    noDeadline: "Не задан",
    noNextAction: "Не задано",
    noSlots: "Для этого кейса пока нет требований к документам.",
    upload: "Загрузить файл",
    resubmit: "Загрузить новую версию",
    sending: "Загрузка…",
    saved: "Новая версия сохранена.",
    invalid: "Выберите PDF, JPEG или PNG размером до 25 MiB.",
    unavailable: "Файл не подтверждён Storage. Повторите эту же отправку.",
    readOnly: "Закрытый кейс доступен только для чтения.",
    hiddenByPreview: "В режиме просмотра Sales действия Admissions скрыты.",
    version: "Версия",
    uploadedBy: "Загрузил",
    size: "Размер",
    pending: "Скачивание станет доступно после серверной проверки.",
    download: "Скачать",
    review: "Решение Admissions",
    approved: "Принять",
    correction: "Запросить исправление",
    rejected: "Отклонить",
    reason: "Причина (обязательна для исправления или отказа)",
    saveReview: "Сохранить решение",
    reviewSaved: "Решение Admissions сохранено.",
    reviewInvalid: "Решение отклонено: проверьте выбор и причину.",
    reviewUnavailable:
      "Supabase не подтвердил решение. Повторите именно эту отправку.",
  },
  ky: {
    title: "Жеке документтер",
    description:
      "Ар бир сап — документ талабы. Файлдар купуя Supabase Storage ичинде сакталат, кайра тапшыруу өзгөртүлбөс жаңы версия түзөт.",
    required: "Талап",
    deadline: "Мөөнөт",
    nextAction: "Кийинки аракет",
    noDeadline: "Көрсөтүлгөн эмес",
    noNextAction: "Көрсөтүлгөн эмес",
    noSlots: "Бул кейс үчүн азырынча документ талабы жок.",
    upload: "Файл жүктөө",
    resubmit: "Жаңы версия жүктөө",
    sending: "Жүктөлүүдө…",
    saved: "Жаңы версия сакталды.",
    invalid: "25 MiB чейин PDF, JPEG же PNG тандаңыз.",
    unavailable: "Storage файлды ырастаган жок. Ушул эле жөнөтүүнү кайталаңыз.",
    readOnly: "Жабык кейсти окууга гана болот.",
    hiddenByPreview: "Sales көрүү режиминде Admissions аракеттери жашырылган.",
    version: "Версия",
    uploadedBy: "Жүктөгөн",
    size: "Өлчөм",
    pending: "Сервер текшергенден кийин жүктөп алуу жеткиликтүү болот.",
    download: "Жүктөп алуу",
    review: "Admissions чечими",
    approved: "Кабыл алуу",
    correction: "Оңдоону суроо",
    rejected: "Четке кагуу",
    reason: "Себеп (оңдоо же четке кагуу үчүн милдеттүү)",
    saveReview: "Чечимди сактоо",
    reviewSaved: "Admissions чечими сакталды.",
    reviewInvalid: "Чечим четке кагылды: тандоону жана себебин текшериңиз.",
    reviewUnavailable:
      "Supabase чечимди ырастаган жок. Так ушул жөнөтүүнү кайталаңыз.",
  },
  en: {
    title: "Private documents",
    description:
      "Each row is a document requirement. Files live in private Supabase Storage and every resubmission creates a new immutable version.",
    required: "Requirement",
    deadline: "Deadline",
    nextAction: "Next action",
    noDeadline: "Not set",
    noNextAction: "Not set",
    noSlots: "No document requirements exist for this case yet.",
    upload: "Upload file",
    resubmit: "Upload new version",
    sending: "Uploading…",
    saved: "A new version was saved.",
    invalid: "Choose a PDF, JPEG or PNG file up to 25 MiB.",
    unavailable: "Storage did not confirm the file. Retry this same submission.",
    readOnly: "A closed case is read-only.",
    hiddenByPreview: "Admissions actions are hidden in Sales preview.",
    version: "Version",
    uploadedBy: "Uploaded by",
    size: "Size",
    pending: "Download becomes available after server validation.",
    download: "Download",
    review: "Admissions decision",
    approved: "Approve",
    correction: "Request correction",
    rejected: "Reject",
    reason: "Reason (required for correction or rejection)",
    saveReview: "Save decision",
    reviewSaved: "The Admissions decision was saved.",
    reviewInvalid: "The decision was rejected. Check the selection and reason.",
    reviewUnavailable:
      "Supabase did not confirm the decision. Retry this exact submission.",
  },
} as const;

function formatBytes(value: number, locale: Locale): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return value < 1024 * 1024
    ? `${formatter.format(value / 1024)} KiB`
    : `${formatter.format(value / (1024 * 1024))} MiB`;
}

function formatDate(value: string | null, locale: Locale, absent: string): string {
  return value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value))
    : absent;
}

function currentVersion(
  versions: readonly PlatformDocumentVersion[],
): PlatformDocumentVersion | null {
  return versions.find((version) => version.isCurrent) ?? null;
}

export function PlatformPrivateDocumentsPanel({
  locale,
  presentationRole,
  workspace,
  requestIds,
  reviewFeedback,
}: Readonly<{
  locale: Locale;
  presentationRole: FixedRole;
  workspace: PlatformCaseDocumentWorkspace;
  requestIds: PlatformDocumentRequestIds;
  reviewFeedback?: PlatformDocumentReviewFeedback;
}>) {
  const router = useRouter();
  const copy = COPY[locale];
  const canWrite = workspace.caseState === "active" && presentationRole !== "sales";
  const [submission, setSubmission] = useState<Submission>({
    slotId: "",
    status: "idle",
  });

  async function upload(
    event: FormEvent<HTMLFormElement>,
    documentSlotId: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (
      !(file instanceof File)
      || file.size < 1
      || file.size > MAX_FILE_BYTES
      || !ACCEPTED_FILE_TYPES.includes(file.type)
    ) {
      setSubmission({ slotId: documentSlotId, status: "error", message: copy.invalid });
      return;
    }
    setSubmission({ slotId: documentSlotId, status: "sending" });
    try {
      const response = await fetch(
        `/api/v2/document-slots/${documentSlotId}/versions`,
        { method: "POST", body: formData },
      );
      if (response.status !== 201) {
        setSubmission({ slotId: documentSlotId, status: "error", message: copy.unavailable });
        return;
      }
      form.reset();
      setSubmission({ slotId: documentSlotId, status: "saved", message: copy.saved });
      router.refresh();
    } catch {
      setSubmission({ slotId: documentSlotId, status: "error", message: copy.unavailable });
    }
  }

  return (
    <section
      id="case-documents"
      className="scroll-mt-24 border-t border-border pt-6"
      data-testid="platform-private-documents"
    >
      <span id="documents" className="block scroll-mt-24" />
      <header>
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-fg">
          {copy.title}
        </h2>
        <p className="mt-1 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
        {reviewFeedback ? (
          <p
            className={cn(
              "mt-3 border-l-2 px-3 py-2 text-sm",
              reviewFeedback.outcome === "saved"
                ? "border-ok bg-ok-weak text-ok"
                : reviewFeedback.outcome === "invalid"
                  ? "border-warn bg-warn-weak text-warn"
                  : "border-danger bg-danger-weak text-danger",
            )}
            role="status"
            data-testid="platform-document-review-feedback"
            data-outcome={reviewFeedback.outcome}
          >
            {reviewFeedback.outcome === "saved"
              ? copy.reviewSaved
              : reviewFeedback.outcome === "invalid"
                ? copy.reviewInvalid
                : copy.reviewUnavailable}
          </p>
        ) : null}
      </header>

      {!canWrite ? (
        <p className="mt-4 border-y border-border py-3 text-sm text-fg-3" role="status">
          {presentationRole === "sales" ? copy.hiddenByPreview : copy.readOnly}
        </p>
      ) : null}

      {workspace.slots.length === 0 ? (
        <p className="mt-4 text-sm text-fg-3">{copy.noSlots}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {workspace.slots.map((slot) => {
            const current = currentVersion(slot.versions);
            const uploadRequestId = requestIds.uploadBySlot[slot.documentSlotId];
            return (
              <Card key={slot.documentSlotId} className="shadow-none">
                <div
                  data-testid="platform-document-slot"
                  data-document-slot-id={slot.documentSlotId}
                  data-slot-status={slot.status}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                        {copy.required}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-fg">
                        {slot.requirementLabel}
                      </h3>
                      {slot.instructions ? (
                        <p className="mt-1 max-w-[56ch] text-sm text-fg-2">
                          {slot.instructions}
                        </p>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-surface-2 px-2 py-1 text-2xs font-semibold text-fg-2">
                      {slot.status}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs text-fg-3 sm:grid-cols-2">
                    <div><dt className="font-semibold">{copy.deadline}</dt><dd>{formatDate(slot.deadline, locale, copy.noDeadline)}</dd></div>
                    <div><dt className="font-semibold">{copy.nextAction}</dt><dd>{slot.nextAction ?? copy.noNextAction}</dd></div>
                  </dl>

                  {canWrite && uploadRequestId ? (
                    <form
                      className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                      onSubmit={(event) => upload(event, slot.documentSlotId)}
                      data-testid="platform-document-upload-form"
                    >
                      <input type="hidden" name="request_id" value={uploadRequestId} />
                      <label>
                        <span className={labelCls}>
                          {slot.versions.length === 0 ? copy.upload : copy.resubmit}
                        </span>
                        <input
                          required
                          name="file"
                          type="file"
                          accept={ACCEPTED_FILE_TYPES.join(",")}
                          className={inputCls}
                        />
                      </label>
                      <button
                        type="submit"
                        className={btnCls}
                        disabled={submission.slotId === slot.documentSlotId && submission.status === "sending"}
                      >
                        {submission.slotId === slot.documentSlotId && submission.status === "sending"
                          ? copy.sending
                          : slot.versions.length === 0 ? copy.upload : copy.resubmit}
                      </button>
                      {submission.slotId === slot.documentSlotId && submission.message ? (
                        <p className={cn("text-xs sm:col-span-2", submission.status === "error" ? "text-danger" : "text-ok")} role="status">
                          {submission.message}
                        </p>
                      ) : null}
                    </form>
                  ) : null}

                  {slot.versions.length > 0 ? (
                    <ol className="mt-5 space-y-3">
                      {slot.versions.map((version) => (
                        <li
                          key={version.documentVersionId}
                          className="rounded-ctl border border-border bg-surface-2 p-3"
                          data-testid="platform-document-version"
                          data-version-number={version.versionNumber}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 text-xs text-fg-2">
                              <p className="break-words font-semibold text-fg">
                                {copy.version} {version.versionNumber} · {version.originalFilename}
                              </p>
                              <p className="mt-1">
                                {copy.uploadedBy}: {version.submittedByDisplayName} · {copy.size}: {formatBytes(version.byteSize, locale)}
                              </p>
                              {version.latestReview ? (
                                <p className="mt-1">{copy.review}: {version.latestReview.decision}{version.latestReview.reason ? ` · ${version.latestReview.reason}` : ""}</p>
                              ) : null}
                            </div>
                            {version.downloadReady ? (
                              <a
                                href={`/api/v2/document-versions/${version.documentVersionId}/download`}
                                className={btnGhostCls}
                                data-testid="platform-document-download"
                              >
                                {copy.download}
                              </a>
                            ) : (
                              <span className="text-xs text-warn">{copy.pending}</span>
                            )}
                          </div>

                          {canWrite && current?.documentVersionId === version.documentVersionId && slot.status === "submitted" ? (
                            <form action={reviewPlatformDocumentVersionAction} className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                              <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
                              <input type="hidden" name="document_version_id" value={version.documentVersionId} />
                              <input type="hidden" name="request_id" value={requestIds.reviewByVersion[version.documentVersionId]} />
                              <label><span className={labelCls}>{copy.review}</span><select name="decision" className={inputCls} defaultValue="approved"><option value="approved">{copy.approved}</option><option value="correction_required">{copy.correction}</option><option value="rejected">{copy.rejected}</option></select></label>
                              <label><span className={labelCls}>{copy.reason}</span><input name="reason" maxLength={2000} className={inputCls} /></label>
                              <button type="submit" className={btnCls}>{copy.saveReview}</button>
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
