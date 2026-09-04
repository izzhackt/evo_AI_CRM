"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, type FormEvent } from "react";

import { Pill } from "@/components/v3/Pill";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import {
  changePlatformDocumentSlotMetadataAction,
  createPlatformCustomDocumentSlotAction,
  removePlatformDocumentSlotAction,
  type PlatformDocumentChecklistActionState,
} from "@/lib/platform-document-checklist-actions";
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

function checklistMessage(status: PlatformDocumentChecklistActionState["status"]): string | null {
  switch (status) {
    case "idle":
      return null;
    case "saved":
      return "Чек-лист сохранён.";
    case "invalid":
      return "Проверьте название и группу документа.";
    case "forbidden":
      return "У этой роли нет права изменять чек-лист.";
    case "stale":
      return "Пункт уже изменён другим сотрудником. Обновите страницу.";
    case "request_conflict":
      return "Эта команда уже использована с другими данными. Обновите страницу.";
    case "unavailable":
      return "База не подтвердила изменение. Чек-лист не изменён.";
  }
}

function ChecklistFeedback({
  state,
}: Readonly<{ state: PlatformDocumentChecklistActionState }>) {
  const message = checklistMessage(state.status);
  if (!message) return null;
  return (
    <p
      className={state.status === "saved" ? "text-xs text-ok" : "text-xs text-danger"}
      role="status"
      data-testid="v3-document-checklist-status"
      data-outcome={state.status}
    >
      {message}
    </p>
  );
}

function useRefreshAfterSave(status: PlatformDocumentChecklistActionState["status"]) {
  const router = useRouter();
  useEffect(() => {
    if (status === "saved") router.refresh();
  }, [router, status]);
}

function CreateChecklistItem({
  studentCaseId,
  requestId,
}: Readonly<{
  studentCaseId: string;
  requestId: string;
}>) {
  const initialState: PlatformDocumentChecklistActionState = {
    status: "idle",
    requestId,
    documentSlotId: null,
    version: null,
  };
  const [state, action, pending] = useActionState(
    createPlatformCustomDocumentSlotAction,
    initialState,
  );
  useRefreshAfterSave(state.status);
  const locked = pending || state.status === "saved";

  return (
    <form
      action={action}
      className="grid gap-3 border-b border-border bg-surface-2 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] md:items-end"
      aria-busy={pending}
      data-testid="v3-document-checklist-create"
    >
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId || requestId} />
      <label>
        <span className={labelCls}>Новый документ</span>
        <input
          required
          name="label"
          maxLength={500}
          className={inputCls}
          placeholder="Например, справка из банка"
          disabled={locked}
        />
      </label>
      <label>
        <span className={labelCls}>Группа</span>
        <input
          required
          name="group_label"
          maxLength={200}
          className={inputCls}
          defaultValue="Дополнительные документы"
          disabled={locked}
        />
      </label>
      <button type="submit" className={btnCls} disabled={locked}>
        {pending ? "Добавляем…" : "Добавить"}
      </button>
      <div className="md:col-span-3">
        <ChecklistFeedback state={state} />
      </div>
    </form>
  );
}

function ChecklistItemControls({
  item,
  studentCaseId,
}: Readonly<{
  item: DocumentItem;
  studentCaseId: string;
}>) {
  const metadataRequestId = item.metadataRequestId ?? "";
  const removalRequestId = item.removalRequestId ?? "";
  const baseVersion = String(item.version);
  const initialMetadataState: PlatformDocumentChecklistActionState = {
    status: "idle",
    requestId: metadataRequestId,
    documentSlotId: item.id,
    version: baseVersion,
  };
  const initialRemovalState: PlatformDocumentChecklistActionState = {
    status: "idle",
    requestId: removalRequestId,
    documentSlotId: item.id,
    version: baseVersion,
  };
  const [metadataState, metadataAction, metadataPending] = useActionState(
    changePlatformDocumentSlotMetadataAction,
    initialMetadataState,
  );
  const [removalState, removalAction, removalPending] = useActionState(
    removePlatformDocumentSlotAction,
    initialRemovalState,
  );
  useRefreshAfterSave(metadataState.status);
  useRefreshAfterSave(removalState.status);
  const metadataLocked = metadataPending
    || metadataState.status === "saved"
    || metadataState.status === "stale";
  const removalLocked = removalPending
    || removalState.status === "saved"
    || removalState.status === "stale";

  return (
    <details className="mt-3 rounded-card border border-border bg-surface-2 px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-fg-2">
        Изменить пункт
      </summary>
      <form
        action={metadataAction}
        className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] md:items-end"
        aria-busy={metadataPending}
        data-testid="v3-document-checklist-edit"
      >
        <input type="hidden" name="student_case_id" value={studentCaseId} />
        <input type="hidden" name="document_slot_id" value={item.id} />
        <input
          type="hidden"
          name="expected_version"
          value={metadataState.version ?? baseVersion}
        />
        <input
          type="hidden"
          name="request_id"
          value={metadataState.requestId || metadataRequestId}
        />
        <input
          type="hidden"
          name="reason"
          value="Обновление пункта чек-листа сотрудником"
        />
        <label>
          <span className={labelCls}>Название</span>
          <input
            required
            name="label"
            maxLength={500}
            className={inputCls}
            defaultValue={item.name}
            disabled={metadataLocked}
          />
        </label>
        <label>
          <span className={labelCls}>Группа</span>
          <input
            required
            name="group_label"
            maxLength={200}
            className={inputCls}
            defaultValue={item.groupLabel}
            disabled={metadataLocked}
          />
        </label>
        <button type="submit" className={btnGhostCls} disabled={metadataLocked}>
          {metadataPending ? "Сохраняем…" : "Сохранить"}
        </button>
        <div className="md:col-span-3">
          <ChecklistFeedback state={metadataState} />
        </div>
      </form>

      <form
        action={removalAction}
        className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
        aria-busy={removalPending}
        data-testid="v3-document-checklist-remove"
      >
        <input type="hidden" name="student_case_id" value={studentCaseId} />
        <input type="hidden" name="document_slot_id" value={item.id} />
        <input
          type="hidden"
          name="expected_version"
          value={removalState.version ?? baseVersion}
        />
        <input
          type="hidden"
          name="request_id"
          value={removalState.requestId || removalRequestId}
        />
        <input
          type="hidden"
          name="reason"
          value="Удаление пункта из активного чек-листа сотрудником"
        />
        <p className="text-xs text-fg-3">Файлы сохранятся в истории дела.</p>
        <button type="submit" className={btnGhostCls} disabled={removalLocked}>
          {removalPending ? "Убираем…" : "Убрать из чек-листа"}
        </button>
        <div className="w-full">
          <ChecklistFeedback state={removalState} />
        </div>
      </form>
    </details>
  );
}

export function ProfileDocumentsClient({
  groups,
  uploadAccess,
  studentCaseId,
  createRequestId,
}: Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
  studentCaseId: string | null;
  createRequestId: string | null;
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

      {uploadAccess === "allowed" && studentCaseId && createRequestId ? (
        <CreateChecklistItem
          key={createRequestId}
          studentCaseId={studentCaseId}
          requestId={createRequestId}
        />
      ) : uploadAccess === "allowed" ? (
        <p className="border-b border-border px-4 py-3 text-sm text-danger" role="status">
          Изменение чек-листа недоступно: сервер не подтвердил дело или команду.
        </p>
      ) : null}

      <ul>
        {groups.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-fg-3">
            Для этого дела требования к документам ещё не назначены.
          </li>
        ) : null}
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
                      data-document-intent={item.intentKind}
                      data-document-slot-version={item.version}
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

                      {uploadAccess === "allowed" && studentCaseId
                        && item.metadataRequestId && item.removalRequestId ? (
                          <ChecklistItemControls
                            key={`${item.id}:${item.version}`}
                            item={item}
                            studentCaseId={studentCaseId}
                          />
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
