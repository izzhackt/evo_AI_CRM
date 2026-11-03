"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";

import { CheckMark } from "@/components/portal/CheckMark";
import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

type UploadState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "uploading"; progress: number }>
  | Readonly<{ status: "confirming" }>
  | Readonly<{ status: "success"; message: string }>
  | Readonly<{ status: "error"; message: string }>;

/**
 * Real upload percentage needs the bytes-sent event `fetch` does not expose
 * for request bodies, so the POST itself stays XHR. Everything else —
 * headers, credentials, response shape — matches the previous `fetch` call.
 */
function postDocumentVersion(
  documentSlotId: string,
  formData: FormData,
  idempotencyKey: string,
  onProgress: (percent: number) => void,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/portal/document-slots/${encodeURIComponent(documentSlotId)}/versions`,
    );
    xhr.responseType = "json";
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Idempotency-Key", idempotencyKey);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      resolve({ status: xhr.status, body: xhr.response });
    };
    xhr.onerror = () => reject(new Error("document_upload_network_error"));
    xhr.send(formData);
  });
}

export function PortalDocumentControls({
  documentSlotId,
  documentVersionId,
  originalFilename,
  allowUpload,
  locale,
  idScope = "",
}: {
  documentSlotId: string;
  documentVersionId: string | null;
  originalFilename: string | null;
  allowUpload: boolean;
  locale: Locale;
  /** Приставка id полей: второй экземпляр (окно «Загрузить документ») не дублирует id строки. */
  idScope?: string;
}) {
  // PORT-6a: все подписи и сообщения — из неймспейса admission
  // (RU байт-в-байт прежние, KY полный); локаль приходит из server-родителя
  // тем же паттерном, что и Shell.
  const strings = getPortalStrings("admission", locale);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const uploadIdempotencyKeyRef = useRef<string | null>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  // Имя выбранного файла: «Повторить» после сбоя отправляет его же.
  const [chosen, setChosen] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const pending = state.status === "uploading" || state.status === "confirming" || refreshing;
  const fieldId = `portal-document-${idScope}${documentSlotId}`;
  // Процент остаётся только визуальным: живая область с ним объявляла бы
  // каждый тик прогресса.
  const feedback = state.status === "uploading"
    ? strings.uploadingButton
    : state.status === "confirming"
      ? strings.uploadConfirming
      : state.status === "success"
        ? `${state.message}${refreshing ? ` ${strings.uploadRefreshing}` : ""}`
        : state.status === "error" ? state.message : "";

  const feedbackTone = state.status === "error"
    ? "pt-doc-feedback-error"
    : state.status === "success" ? "pt-doc-feedback-ok" : "";

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    if (Array.from(formData.keys()).some((key) => key !== "file")) {
      setState({ status: "error", message: strings.errorFormUnavailable });
      return;
    }

    setState({ status: "uploading", progress: 0 });
    try {
      const idempotencyKey =
        uploadIdempotencyKeyRef.current ?? crypto.randomUUID();
      uploadIdempotencyKeyRef.current = idempotencyKey;
      const response = await postDocumentVersion(
        documentSlotId,
        formData,
        idempotencyKey,
        (percent) => {
          setState((current) => {
            if (current.status !== "uploading" && current.status !== "confirming") return current;
            return percent >= 100 ? { status: "confirming" } : { status: "uploading", progress: percent };
          });
        },
      );
      if (response.status !== 201) {
        setState({ status: "error", message: uploadFailureMessage(response.status, strings) });
        return;
      }

      const payload: unknown = response.body;
      const receipt = exactUploadReceipt(payload, documentSlotId);
      if (!receipt) {
        setState({
          status: "error",
          message: strings.errorReceipt,
        });
        return;
      }

      uploadIdempotencyKeyRef.current = null;
      formRef.current?.reset();
      setChosen(null);
      setState({
        status: "success",
        message: formatPortalString(strings.uploadSuccess, { name: receipt.originalFilename }),
      });
      startRefresh(() => router.refresh());
    } catch {
      setState({
        status: "error",
        message: strings.errorNetwork,
      });
    }
  }

  return (
    <div className="pt-doc-controls">
      {allowUpload ? (
        <form ref={formRef} onSubmit={upload} aria-busy={pending} className="pt-doc-upload">
          {/* «Загрузить» — подпись к скрытому полю файла: выбранный файл сразу
              уходит тем же XHR-путём; после сбоя рядом кнопка «Повторить». */}
          <label
            htmlFor={fieldId}
            className="pt-btn-ghost pt-doc-pick"
            data-pending={pending ? "" : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 13V3.5M6.5 7 10 3.5 13.5 7M4 12.5v3h12v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {state.status === "uploading"
              ? <>{strings.uploadingButton} <span aria-hidden="true">{state.progress}%</span></>
              : state.status === "confirming"
                ? strings.confirmingButton
                : refreshing ? strings.refreshingButton : documentVersionId ? strings.replaceButton : strings.uploadButton}
            <span className="pt-sr-only">: {strings.uploadLabel}</span>
            <input
              id={fieldId}
              name="file"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png"
              disabled={pending}
              aria-describedby={`${fieldId}-hint ${fieldId}-feedback`}
              onChange={(event) => {
                uploadIdempotencyKeyRef.current = null;
                setState({ status: "idle" });
                setChosen(event.currentTarget.files?.[0]?.name ?? null);
                if (event.currentTarget.files?.length) formRef.current?.requestSubmit();
              }}
              className="pt-doc-file"
            />
          </label>
          {state.status === "error" && chosen !== null ? (
            <button
              type="submit"
              disabled={pending}
              aria-disabled={pending}
              className="pt-btn pt-doc-retry"
            >
              {strings.retryUploadButton}
            </button>
          ) : null}
          {state.status === "uploading" || state.status === "confirming" ? (
            <progress
              value={state.status === "uploading" ? state.progress : 100}
              max={100}
              aria-hidden="true"
              className="pt-progress pt-doc-progress"
            />
          ) : null}
          <p id={`${fieldId}-hint`} className="pt-sr-only">{strings.uploadHint}</p>
        </form>
      ) : (
        <p className="pt-doc-locked">{strings.uploadLocked}</p>
      )}

      {documentVersionId ? (
        <a
          href={`/api/portal/document-versions/${encodeURIComponent(documentVersionId)}/download`}
          className="pt-link pt-doc-download"
          aria-label={formatPortalString(strings.downloadAria, { name: originalFilename ?? strings.lastFileFallback })}
        >
          {strings.downloadButton}
        </a>
      ) : null}

      <p
        id={`${fieldId}-feedback`}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
        aria-atomic="true"
        className={`pt-doc-feedback ${feedbackTone}`}
      >
        {state.status === "success" ? <CheckMark fresh /> : null}
        {feedback}
      </p>
    </div>
  );
}

function exactUploadReceipt(
  value: unknown,
  expectedDocumentSlotId: string,
): Readonly<{ originalFilename: string }> | null {
  if (!isRecord(value) || !hasExactKeys(value, ["document"])) return null;
  const document = value.document;
  if (
    !isRecord(document)
    || !hasExactKeys(document, [
      "documentSlotId",
      "documentVersionId",
      "versionNumber",
      "originalFilename",
      "declaredMimeType",
      "byteSize",
    ])
    || document.documentSlotId !== expectedDocumentSlotId
    || !isUuid(document.documentVersionId)
    || !Number.isSafeInteger(document.versionNumber)
    || Number(document.versionNumber) < 1
    || typeof document.originalFilename !== "string"
    || document.originalFilename.length < 1
    || document.originalFilename.length > 255
    || !["application/pdf", "image/jpeg", "image/png"].includes(
      String(document.declaredMimeType),
    )
    || !Number.isSafeInteger(document.byteSize)
    || Number(document.byteSize) < 1
    || Number(document.byteSize) > 25 * 1024 * 1024
  ) {
    return null;
  }
  return { originalFilename: document.originalFilename };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  return actual.length === normalizedExpected.length
    && actual.every((key, index) => key === normalizedExpected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && UUID_PATTERN.test(value)
    && value.toLowerCase() !== NIL_UUID;
}

function uploadFailureMessage(
  status: number,
  strings: PortalStrings<"admission">,
): string {
  if (status === 400 || status === 415) {
    return strings.errorBadFile;
  }
  if (status === 403) return strings.errorForbidden;
  if (status === 409) return strings.errorConflict;
  if (status === 413) return strings.errorTooLarge;
  if (status === 422) return strings.errorScan;
  if (status === 429) return strings.errorTooMany;
  return strings.errorUnavailable;
}
