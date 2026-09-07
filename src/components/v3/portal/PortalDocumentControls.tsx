"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

type UploadState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "uploading" }>
  | Readonly<{ status: "success"; message: string }>
  | Readonly<{ status: "error"; message: string }>;

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
  const pending = state.status === "uploading" || refreshing;

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    if (Array.from(formData.keys()).some((key) => key !== "file")) {
      setState({ status: "error", message: "Форма загрузки недоступна." });
      return;
    }

    setState({ status: "uploading" });
    try {
      const idempotencyKey =
        uploadIdempotencyKeyRef.current ?? crypto.randomUUID();
      uploadIdempotencyKeyRef.current = idempotencyKey;
      const response = await fetch(
        `/api/portal/document-slots/${encodeURIComponent(documentSlotId)}/versions`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: formData,
          credentials: "same-origin",
        },
      );
      if (response.status !== 201) {
        setState({ status: "error", message: uploadFailureMessage(response.status) });
        return;
      }

      const payload: unknown = await response.json();
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
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      {allowUpload ? (
        <form ref={formRef} onSubmit={upload} className="min-w-0 flex-1">
          <label
            htmlFor={`portal-document-${documentSlotId}`}
            className="block text-xs font-semibold text-fg"
          >
            Загрузить новый файл
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id={`portal-document-${documentSlotId}`}
              name="file"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png"
              disabled={pending}
              onChange={() => {
                uploadIdempotencyKeyRef.current = null;
                setState({ status: "idle" });
              }}
              className="min-h-11 min-w-0 flex-1 rounded-nav border border-control-edge bg-surface px-3 py-2 text-sm text-fg file:me-3 file:rounded-nav file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:font-medium file:text-fg disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={pending}
              aria-disabled={pending}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-nav bg-accent px-4 text-sm font-semibold text-on-accent transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Загружаем…" : "Загрузить"}
            </button>
          </div>
          <p className="mt-1 text-xs text-fg-3">PDF, JPG или PNG, до 25 МБ.</p>
        </form>
      ) : (
        <p className="text-sm text-fg-2">Принятый документ доступен только для скачивания.</p>
      )}

      {documentVersionId ? (
        <a
          href={`/api/portal/document-versions/${encodeURIComponent(documentVersionId)}/download`}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-nav border border-control-edge bg-surface px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-2"
          aria-label={`Скачать ${originalFilename ?? "последний файл"}`}
        >
          Скачать последний файл
        </a>
      ) : null}

      {state.status === "success" || state.status === "error" ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className="w-full text-sm text-fg-2"
        >
          {state.message}
        </p>
      ) : null}
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
