"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Pill } from "@/components/v3/Pill";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { documentPresence } from "@/lib/v3/wording";

import type {
  DocumentGroup,
  DocumentItem,
  DocumentUploadAccess,
} from "./document-types";

const ACCEPTED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

type UploadOutcome = "idle" | "sending" | "saved" | "invalid" | "forbidden" | "unavailable";

type UploadState = Readonly<{
  outcome: UploadOutcome;
  message: string | null;
}>;

const IDLE_UPLOAD: UploadState = Object.freeze({ outcome: "idle", message: null });

const ACCESS_MESSAGE: Record<Exclude<DocumentUploadAccess, "allowed">, string> = {
  forbidden: "В режиме этой роли документы доступны только для просмотра.",
  closed: "Закрытое дело доступно только для просмотра.",
};

const OUTCOME_MESSAGE: Record<Exclude<UploadOutcome, "idle" | "sending">, string> = {
  saved: "Файл сохранён в приватном хранилище.",
  invalid: "Выберите PDF, JPEG или PNG размером до 25 MiB.",
  forbidden: "У вашей роли нет права загружать этот документ.",
  unavailable: "Хранилище не подтвердило загрузку. Файл не отмечен как сохранённый.",
};

function uploadState(
  states: Readonly<Record<string, UploadState>>,
  itemId: string,
): UploadState {
  return states[itemId] ?? IDLE_UPLOAD;
}

function fileIsAccepted(value: FormDataEntryValue | null): value is File {
  return value instanceof File
    && value.size > 0
    && value.size <= MAX_FILE_BYTES
    && ACCEPTED_FILE_TYPES.some((type) => type === value.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uploadWasConfirmed(value: unknown, item: DocumentItem): boolean {
  if (!isRecord(value) || !isRecord(value.document)) return false;
  const document = value.document;
  return document.documentSlotId === item.id
    && typeof document.documentVersionId === "string"
    && document.documentVersionId.length > 0
    && typeof document.versionNumber === "number"
    && Number.isInteger(document.versionNumber)
    && document.versionNumber > 0;
}

function responseOutcome(status: number): Extract<UploadOutcome, "invalid" | "forbidden" | "unavailable"> {
  if (status === 401 || status === 403) return "forbidden";
  return status >= 400 && status < 500 ? "invalid" : "unavailable";
}

function statusTone(item: DocumentItem): "neutral" | "ok" {
  return item.presence === "present" ? "ok" : "neutral";
}

export function ProfileDocumentsClient({
  groups,
  uploadAccess,
}: Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
}>) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Readonly<Record<string, UploadState>>>({});

  function record(itemId: string, outcome: UploadOutcome, message: string | null) {
    setUploads((current) => ({ ...current, [itemId]: { outcome, message } }));
  }

  async function upload(event: FormEvent<HTMLFormElement>, item: DocumentItem) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");

    if (uploadAccess !== "allowed" || !item.uploadRequestId) {
      record(item.id, "forbidden", OUTCOME_MESSAGE.forbidden);
      return;
    }
    if (!fileIsAccepted(file)) {
      record(item.id, "invalid", OUTCOME_MESSAGE.invalid);
      return;
    }

    record(item.id, "sending", null);
    try {
      const response = await fetch(`/api/v2/document-slots/${item.id}/versions`, {
        method: "POST",
        body: formData,
      });
      if (response.status !== 201) {
        const outcome = responseOutcome(response.status);
        record(item.id, outcome, OUTCOME_MESSAGE[outcome]);
        return;
      }

      const payload: unknown = await response.json().catch(() => null);
      if (!uploadWasConfirmed(payload, item)) {
        record(item.id, "unavailable", OUTCOME_MESSAGE.unavailable);
        return;
      }

      form.reset();
      record(item.id, "saved", OUTCOME_MESSAGE.saved);
      router.refresh();
    } catch {
      record(item.id, "unavailable", OUTCOME_MESSAGE.unavailable);
    }
  }

  return (
    <>
      {uploadAccess !== "allowed" ? (
        <p className="border-b border-border px-4 py-3 text-sm text-fg-3" role="status">
          {ACCESS_MESSAGE[uploadAccess]}
        </p>
      ) : null}

      <ul>
        {groups.map((group) => (
          <li key={group.title} className="border-b border-border last:border-b-0">
            <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-2.5">
              <h4 className="text-sm font-semibold text-fg">{group.title}</h4>
              <span className="font-mono text-2xs text-fg-3">{group.items.length}</span>
            </div>
            {group.items.length === 0 ? (
              <p className="px-4 py-4 text-sm text-fg-3">Требований нет.</p>
            ) : (
              <ul>
                {group.items.map((item) => {
                  const state = uploadState(uploads, item.id);
                  const canUpload = uploadAccess === "allowed" && item.uploadRequestId !== null;
                  return (
                    <li
                      key={item.id}
                      className="border-t border-border px-4 py-3 first:border-t-0"
                      data-testid="v3-document-item"
                      data-document-presence={item.presence}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-fg">{item.name}</p>
                          {item.presence === "present" ? (
                            <p className="mt-0.5 truncate text-xs text-fg-3">
                              {item.currentFilename} · версия {item.currentVersionNumber}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <Pill tone={statusTone(item)}>{documentPresence(item.presence)}</Pill>
                          {item.presence === "present" && item.downloadReady ? (
                            <a
                              href={`/api/v2/document-versions/${item.currentVersionId}/download`}
                              className={btnGhostCls}
                              data-testid="v3-document-download"
                            >
                              Скачать
                            </a>
                          ) : null}
                        </div>
                      </div>

                      {item.presence === "present" && !item.downloadReady ? (
                        <p className="mt-2 text-xs text-fg-3" role="status">
                          Файл есть, но скачивание ещё не подтверждено хранилищем.
                        </p>
                      ) : null}

                      {canUpload ? (
                        <form
                          className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                          onSubmit={(event) => upload(event, item)}
                          data-testid="v3-document-upload-form"
                        >
                          <input type="hidden" name="request_id" value={item.uploadRequestId} />
                          <label>
                            <span className={labelCls}>
                              {item.presence === "present" ? "Заменить файл" : "Загрузить файл"}
                            </span>
                            <input
                              required
                              name="file"
                              type="file"
                              accept={ACCEPTED_FILE_TYPES.join(",")}
                              className={inputCls}
                              disabled={state.outcome === "sending"}
                            />
                          </label>
                          <button
                            type="submit"
                            className={btnCls}
                            disabled={state.outcome === "sending"}
                          >
                            {state.outcome === "sending" ? "Загрузка…" : "Сохранить"}
                          </button>
                        </form>
                      ) : uploadAccess === "allowed" ? (
                        <p className="mt-2 text-xs text-danger" role="status">
                          Загрузка недоступна: сервер не выдал безопасный идентификатор команды.
                        </p>
                      ) : null}

                      {state.message ? (
                        <p
                          className={
                            state.outcome === "saved"
                              ? "mt-2 text-xs text-ok"
                              : state.outcome === "invalid"
                                ? "mt-2 text-xs text-warn"
                                : "mt-2 text-xs text-danger"
                          }
                          role="status"
                          data-testid="v3-document-upload-status"
                          data-outcome={state.outcome}
                        >
                          {state.message}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
