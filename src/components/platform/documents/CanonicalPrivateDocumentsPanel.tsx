"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Card, btnCls, cn, inputCls, labelCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { PrivateDocumentRecord } from "@/lib/server/private-document-repository";

const ACCEPTED_FILE_TYPES = "application/pdf,image/jpeg,image/png";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const COPY = {
  ru: {
    title: "Приватные документы",
    description:
      "Файлы хранятся приватно. Каждая повторная отправка создаёт новую неизменяемую версию.",
    uploadTitle: "Добавить документ",
    resubmitTitle: "Добавить новую версию",
    fileLabel: "PDF, JPEG или PNG",
    fileHint: "Максимальный размер — 25 MiB.",
    upload: "Загрузить",
    resubmit: "Отправить новую версию",
    sending: "Сохранение…",
    saved: "Файл сохранён.",
    invalidFile: "Выберите PDF, JPEG или PNG размером не более 25 MiB.",
    unavailable: "Документ не сохранён. Проверьте файл и попробуйте снова.",
    empty: "Документов пока нет.",
    readOnly: "Кейс не активен: документы доступны только для чтения.",
    version: "Версия",
    created: "Загружен",
    size: "Размер",
    checksum: "SHA-256",
    download: "Скачать",
  },
  ky: {
    title: "Жеке документтер",
    description:
      "Файлдар купуя сакталат. Кайра жөнөтүлгөн сайын өзгөртүлбөс жаңы версия түзүлөт.",
    uploadTitle: "Документ кошуу",
    resubmitTitle: "Жаңы версия кошуу",
    fileLabel: "PDF, JPEG же PNG",
    fileHint: "Эң чоң өлчөмү — 25 MiB.",
    upload: "Жүктөө",
    resubmit: "Жаңы версияны жөнөтүү",
    sending: "Сакталууда…",
    saved: "Файл сакталды.",
    invalidFile: "25 MiB ашпаган PDF, JPEG же PNG файлын тандаңыз.",
    unavailable: "Документ сакталган жок. Файлды текшерип, кайра аракет кылыңыз.",
    empty: "Азырынча документ жок.",
    readOnly: "Кейс активдүү эмес: документтерди окууга гана болот.",
    version: "Версия",
    created: "Жүктөлдү",
    size: "Өлчөмү",
    checksum: "SHA-256",
    download: "Жүктөп алуу",
  },
  en: {
    title: "Private documents",
    description:
      "Files stay private. Every resubmission creates a new immutable version.",
    uploadTitle: "Add a document",
    resubmitTitle: "Add a new version",
    fileLabel: "PDF, JPEG or PNG",
    fileHint: "Maximum size: 25 MiB.",
    upload: "Upload",
    resubmit: "Submit new version",
    sending: "Saving…",
    saved: "File saved.",
    invalidFile: "Choose a PDF, JPEG or PNG file no larger than 25 MiB.",
    unavailable: "The document was not saved. Check the file and try again.",
    empty: "No documents yet.",
    readOnly: "This case is not active, so documents are read-only.",
    version: "Version",
    created: "Uploaded",
    size: "Size",
    checksum: "SHA-256",
    download: "Download",
  },
} as const;

type SubmissionState = Readonly<{
  key: string;
  status: "idle" | "sending" | "saved" | "error";
  message?: string;
}>;

function formatBytes(byteLength: number, locale: Locale): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(byteLength / 1024)} KiB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(byteLength / (1024 * 1024))} MiB`;
}

function formatTimestamp(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function selectedFile(form: HTMLFormElement): File | null {
  const value = new FormData(form).get("file");
  return value instanceof File && value.size > 0 ? value : null;
}

export function CanonicalPrivateDocumentsPanel({
  locale,
  caseId,
  caseStatus,
  documents,
}: Readonly<{
  locale: Locale;
  caseId: string;
  caseStatus: "active" | "paused" | "closed";
  documents: readonly PrivateDocumentRecord[];
}>) {
  const router = useRouter();
  const copy = COPY[locale];
  const canWrite = caseStatus === "active";
  const [submission, setSubmission] = useState<SubmissionState>({
    key: "",
    status: "idle",
  });

  async function submit(
    event: FormEvent<HTMLFormElement>,
    key: string,
    endpoint: string,
    includeCaseId: boolean,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = selectedFile(form);
    if (
      !file ||
      file.size > MAX_FILE_BYTES ||
      !ACCEPTED_FILE_TYPES.split(",").includes(file.type)
    ) {
      setSubmission({ key, status: "error", message: copy.invalidFile });
      return;
    }

    const body = new FormData();
    if (includeCaseId) body.set("caseId", caseId);
    body.set("file", file);
    setSubmission({ key, status: "sending" });

    try {
      const response = await fetch(endpoint, { method: "POST", body });
      if (response.status !== 201) {
        setSubmission({ key, status: "error", message: copy.unavailable });
        return;
      }
      form.reset();
      setSubmission({ key, status: "saved", message: copy.saved });
      router.refresh();
    } catch {
      setSubmission({ key, status: "error", message: copy.unavailable });
    }
  }

  function messageFor(key: string) {
    if (submission.key !== key || submission.status === "idle") return null;
    return (
      <p
        role="status"
        className={cn(
          "text-xs",
          submission.status === "saved" ? "text-ok" : "text-danger",
        )}
      >
        {submission.status === "sending" ? copy.sending : submission.message}
      </p>
    );
  }

  return (
    <section id="documents" data-testid="canonical-private-documents" className="scroll-mt-24">
      <Card title={copy.title} className="shadow-none">
        <p className="max-w-[56ch] text-sm leading-5 text-fg-3">{copy.description}</p>

        {canWrite ? (
          <form
            data-testid="canonical-private-document-upload-form"
            className="mt-5 space-y-3 border-t border-border pt-4"
            onSubmit={(event) => submit(event, "upload", "/api/v2/documents", true)}
          >
            <div>
              <h3 className="text-sm font-semibold text-fg">{copy.uploadTitle}</h3>
              <label className="mt-3 block">
                <span className={labelCls}>{copy.fileLabel}</span>
                <input
                  required
                  name="file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className={inputCls}
                />
              </label>
              <p className="mt-1 text-xs text-fg-3">{copy.fileHint}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className={btnCls}
                disabled={submission.key === "upload" && submission.status === "sending"}
              >
                {submission.key === "upload" && submission.status === "sending"
                  ? copy.sending
                  : copy.upload}
              </button>
              {messageFor("upload")}
            </div>
          </form>
        ) : (
          <p className="mt-4 rounded-card border border-border bg-surface-2 px-4 py-3 text-sm text-fg-2">
            {copy.readOnly}
          </p>
        )}

        {documents.length === 0 ? (
          <p className="mt-5 text-sm text-fg-3">{copy.empty}</p>
        ) : (
          <ul className="mt-5 space-y-4">
            {documents.map((document) => (
              <li
                key={document.documentId}
                data-testid="canonical-private-document"
                data-document-id={document.documentId}
                className="rounded-card border border-border bg-surface p-4"
              >
                <h3 className="text-sm font-semibold text-fg">
                  {document.versions[0]?.originalFilename ?? copy.title}
                </h3>

                <ol className="mt-3 space-y-2">
                  {document.versions.map((version) => (
                    <li
                      key={version.versionId}
                      className="rounded-ctl border border-border bg-surface-2 px-3 py-3"
                    >
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 text-xs text-fg-2">
                          <p className="break-words font-medium text-fg">
                            {copy.version} {version.versionNumber} · {version.originalFilename}
                          </p>
                          <p className="mt-1">
                            {copy.created}: {formatTimestamp(version.createdAt, locale)} · {copy.size}: {formatBytes(version.byteLength, locale)}
                          </p>
                          <p className="mt-1 break-all font-mono text-2xs text-fg-3">
                            {copy.checksum}: {version.sha256}
                          </p>
                        </div>
                        <a
                          data-testid="canonical-private-document-download"
                          data-version-id={version.versionId}
                          data-version-number={version.versionNumber}
                          href={`/api/v2/document-versions/${version.versionId}/download`}
                          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-ctl border border-border bg-surface px-3 text-xs font-semibold text-fg hover:bg-surface-2"
                        >
                          {copy.download}
                        </a>
                      </div>
                    </li>
                  ))}
                </ol>

                {canWrite ? (
                  <form
                    data-testid="canonical-private-document-resubmit-form"
                    className="mt-4 space-y-3 border-t border-border pt-4"
                    onSubmit={(event) =>
                      submit(
                        event,
                        document.documentId,
                        `/api/v2/documents/${document.documentId}/resubmissions`,
                        false,
                      )
                    }
                  >
                    <label className="block">
                      <span className={labelCls}>{copy.resubmitTitle}</span>
                      <input
                        required
                        name="file"
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        className={inputCls}
                      />
                    </label>
                    <p className="text-xs text-fg-3">{copy.fileHint}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        className={btnCls}
                        disabled={
                          submission.key === document.documentId &&
                          submission.status === "sending"
                        }
                      >
                        {submission.key === document.documentId &&
                        submission.status === "sending"
                          ? copy.sending
                          : copy.resubmit}
                      </button>
                      {messageFor(document.documentId)}
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
