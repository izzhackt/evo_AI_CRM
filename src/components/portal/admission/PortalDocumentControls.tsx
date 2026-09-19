"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";

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
}: {
  documentSlotId: string;
  documentVersionId: string | null;
  originalFilename: string | null;
  allowUpload: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const uploadIdempotencyKeyRef = useRef<string | null>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [refreshing, startRefresh] = useTransition();
  const pending = state.status === "uploading" || state.status === "confirming" || refreshing;
  // Процент остаётся только визуальным: живая область с ним объявляла бы
  // каждый тик прогресса.
  const feedback = state.status === "uploading"
    ? "Загружаем файл…"
    : state.status === "confirming"
      ? "Файл отправлен. Ждём подтверждение сохранения."
      : state.status === "success"
        ? `${state.message}${refreshing ? " Обновляем список документов…" : ""}`
        : state.status === "error" ? state.message : "";

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    if (Array.from(formData.keys()).some((key) => key !== "file")) {
      setState({ status: "error", message: "Форма загрузки недоступна." });
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
        setState({ status: "error", message: uploadFailureMessage(response.status) });
        return;
      }

      const payload: unknown = response.body;
      const receipt = exactUploadReceipt(payload, documentSlotId);
      if (!receipt) {
        setState({
          status: "error",
          message: "EVO не смог подтвердить сохранение файла. Попробуйте позже.",
        });
        return;
      }

      uploadIdempotencyKeyRef.current = null;
      formRef.current?.reset();
      setState({
        status: "success",
        message: `Файл «${receipt.originalFilename}» загружен.`,
      });
      startRefresh(() => router.refresh());
    } catch {
      setState({
        status: "error",
        message: "Загрузка сейчас недоступна. Проверьте соединение и попробуйте позже.",
      });
    }
  }

  return (
    <div className="pt-doc-controls">
      {allowUpload ? (
        <form ref={formRef} onSubmit={upload} aria-busy={pending} className="pt-doc-upload">
          <label
            htmlFor={`portal-document-${documentSlotId}`}
            className="pt-field-label"
          >
            Загрузить новый файл
          </label>
          <div className="pt-doc-upload-row">
            <input
              id={`portal-document-${documentSlotId}`}
              name="file"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png"
              disabled={pending}
              aria-describedby={`portal-document-hint-${documentSlotId} portal-document-feedback-${documentSlotId}`}
              onChange={() => {
                uploadIdempotencyKeyRef.current = null;
                setState({ status: "idle" });
              }}
              className="pt-input pt-doc-file"
            />
            <button
              type="submit"
              disabled={pending}
              aria-disabled={pending}
              className="pt-btn"
            >
              {state.status === "uploading"
                ? <>Загружаем файл… <span aria-hidden="true">{state.progress}%</span></>
                : state.status === "confirming"
                  ? "Подтверждаем сохранение…"
                  : refreshing ? "Обновляем список…" : state.status === "error" ? "Повторить загрузку" : "Загрузить"}
            </button>
          </div>
          {state.status === "uploading" || state.status === "confirming" ? (
            <progress
              value={state.status === "uploading" ? state.progress : 100}
              max={100}
              aria-hidden="true"
              className="pt-progress pt-doc-progress"
            />
          ) : null}
          <p id={`portal-document-hint-${documentSlotId}`} className="pt-doc-hint">PDF, JPG или PNG, до 25 МБ.</p>
        </form>
      ) : (
        <p className="pt-doc-locked">Принятый документ доступен только для скачивания.</p>
      )}

      {documentVersionId ? (
        <a
          href={`/api/portal/document-versions/${encodeURIComponent(documentVersionId)}/download`}
          className="pt-btn-ghost pt-doc-download"
          aria-label={`Скачать ${originalFilename ?? "последний файл"}`}
        >
          Скачать последний файл
        </a>
      ) : null}

      <p
        id={`portal-document-feedback-${documentSlotId}`}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
        aria-atomic="true"
        className={`pt-doc-feedback ${state.status === "error" ? "pt-doc-feedback-error" : ""}`}
      >
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

function uploadFailureMessage(status: number): string {
  if (status === 400 || status === 415) {
    return "Выберите корректный PDF, JPG или PNG файл.";
  }
  if (status === 403) return "У вас нет доступа к загрузке этого документа.";
  if (status === 409) return "Этот документ уже загружается. Дождитесь завершения.";
  if (status === 413) return "Файл превышает лимит 25 МБ.";
  if (status === 422) return "Файл отклонён проверкой безопасности.";
  if (status === 429) return "Слишком много попыток. Попробуйте немного позже.";
  return "Загрузка сейчас недоступна. Попробуйте позже.";
}
