"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnGhostCls, fieldLabelCls, inputCls } from "@/components/ui";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import {
  applyCaseBaselineChecklistAction,
  createPlatformCustomDocumentSlotAction,
  type PlatformCaseBaselineChecklistActionState,
  type PlatformDocumentChecklistActionState,
} from "@/lib/platform-document-checklist-actions";

import { caseMomentLabel } from "./case-work-view";
import { ChecklistFeedback, useRefreshAfterSave } from "./DocumentChecklistFeedback";
import { DocumentPreviewButton } from "./DocumentPreviewButton";
import { DocumentRecognitionJobs } from "./DocumentRecognitionJobs";
import { DocumentRow, useHydrated } from "./DocumentRow";
import {
  DOCUMENT_UPLOAD_IDLE,
  DOCUMENT_UPLOAD_SAVED,
  documentUploadConfirmed,
  documentUploadErrorCode,
  documentUploadFailure,
  documentUploadFileProblem,
  type DocumentUploadResult,
  type DocumentUploadState,
} from "./document-upload";

import type {
  ActiveDocumentGroup,
  BaselineChecklistOption,
  DocumentItem,
  DocumentUploadAccess,
  DocumentRecognitionAccess,
  RemovedDocumentGroup,
} from "./document-types";

const ACCESS_MESSAGE: Record<Exclude<DocumentUploadAccess, "allowed">, string> = {
  forbidden: "В режиме этой роли документы доступны только для просмотра.",
  closed: "Закрытое дело доступно только для просмотра.",
};

/** id области «+ Документ»: на странице одна вкладка «Документы». */
const ADD_REGION_ID = "case-documents-add";

function RemovedDocumentHistory({
  groups,
  today,
}: Readonly<{ groups: readonly RemovedDocumentGroup[]; today: string }>) {
  if (groups.length === 0) return null;

  return (
    <section
      className="space-y-2 pt-2"
      aria-labelledby="removed-document-history-title"
      data-testid="v3-removed-document-history"
    >
      <div className="border-b border-border pb-2">
        <h3 id="removed-document-history-title" className="t-item text-fg">
          История удалённых пунктов
        </h3>
        <p className="t-meta text-fg-2">
          Удалённые пункты и их файлы сохранены только для просмотра.
        </p>
      </div>

      <ul>
        {groups.map((group) => (
          <li key={group.title}>
            <div className="flex items-center justify-between gap-3 py-2">
              <h4 className="t-caption text-fg-2">{group.title}</h4>
              <span className="t-caption tabular-nums text-fg-2">{group.items.length}</span>
            </div>
            <ul>
              {group.items.map((item) => (
                <li
                  key={item.id}
                  className="border-t border-border py-3"
                  data-testid="v3-removed-document-item"
                  data-document-intent={item.intentKind}
                >
                  <p className="t-item text-fg">{item.name}</p>
                  <p className="t-meta text-fg-2">
                    Удалено <time dateTime={item.removedAt} className="font-mono tabular-nums">{caseMomentLabel(item.removedAt, today)}</time>
                    {" · "}Причина: {item.removalReason}
                  </p>

                  {item.versions.length === 0 ? (
                    <p className="mt-2 t-meta text-fg-2">Файлы к пункту не загружались.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-border border-t border-border">
                      {item.versions.map((version) => (
                        <li
                          key={version.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2"
                          data-testid="v3-removed-document-version"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate t-body-compact text-fg">
                              {version.filename} · версия {version.versionNumber}
                            </p>
                            <p className="t-meta text-fg-2">
                              {version.submittedBy} · <time dateTime={version.submittedAt} className="font-mono tabular-nums">{caseMomentLabel(version.submittedAt, today)}</time>
                            </p>
                          </div>
                          {version.downloadReady ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <DocumentPreviewButton key={version.id} versionId={version.id} filename={version.filename} versionNumber={version.versionNumber} />
                              <a
                                href={`/api/v2/document-versions/${version.id}/download`}
                                className={btnGhostCls}
                                data-testid="v3-removed-document-download"
                              >
                                Скачать
                              </a>
                            </div>
                          ) : (
                            <span className="t-meta text-fg-2">
                              Скачивание недоступно
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ApplyBaselineChecklist({
  studentCaseId,
  options,
  requestId,
}: Readonly<{
  studentCaseId: string;
  options: readonly BaselineChecklistOption[];
  requestId: string;
}>) {
  const initialState: PlatformCaseBaselineChecklistActionState = {
    status: "idle",
    requestId,
    countryRequirementVersionId: options[0]?.countryRequirementVersionId ?? null,
    seededCount: null,
  };
  const [state, action, pending] = useActionState(
    applyCaseBaselineChecklistAction,
    initialState,
  );
  // "stale" here means case_already_bound — a permanent state: refresh brings
  // in the seeded checklist (and this form disappears with it).
  useRefreshAfterSave(state.status === "stale" ? "saved" : state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form
      action={action}
      className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      aria-busy={pending}
      data-testid="v3-document-baseline-checklist"
    >
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId || requestId} />
      <label>
        <span className={fieldLabelCls}>Базовый чек-лист</span>
        <select
          required
          name="country_requirement_version_id"
          className={inputCls}
          disabled={locked}
        >
          {options.map((option) => (
            <option
              key={option.countryRequirementVersionId}
              value={option.countryRequirementVersionId}
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={QUEUE_CONFIRM} disabled={locked}>
        {pending ? "Применяем…" : "Применить базовый чек-лист"}
      </button>
      <p className="t-meta text-fg-2 md:col-span-2">
        Привязка версии требований выполняется один раз; страна и степень дела будут зафиксированы.
      </p>
      <div className="md:col-span-2">
        <ChecklistFeedback state={state} />
      </div>
    </form>
  );
}

/**
 * The server could not read the approved baseline versions for this case.
 * Retry re-requests the route (the server read stays the authority); it never
 * applies a checklist or creates an item.
 */
function BaselineChecklistUnavailable() {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3"
      aria-busy={retrying}
      data-testid="v3-document-baseline-checklist-unavailable"
    >
      <p role="alert" className="min-w-0 flex-1 t-body-compact text-danger">
        Не удалось загрузить базовые чек-листы. Это не значит, что их нет — повторите попытку.
      </p>
      <button
        type="button"
        className={QUEUE_SECONDARY}
        disabled={retrying}
        onClick={() => startRetry(() => router.refresh())}
      >
        {retrying ? "Загружаем…" : "Повторить"}
      </button>
    </div>
  );
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
      className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] md:items-end"
      aria-busy={pending}
      data-testid="v3-document-checklist-create"
    >
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId || requestId} />
      <label>
        <span className={fieldLabelCls}>Новый документ</span>
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
        <span className={fieldLabelCls}>Группа</span>
        <input
          required
          name="group_label"
          maxLength={200}
          className={inputCls}
          defaultValue="Дополнительные документы"
          disabled={locked}
        />
      </label>
      <button type="submit" className={QUEUE_CONFIRM} disabled={locked}>
        {pending ? "Добавляем…" : "Добавить"}
      </button>
      <div className="md:col-span-3">
        <ChecklistFeedback state={state} />
      </div>
    </form>
  );
}

/**
 * Вкладка «Документы» дела (Э8.1). Сверху — «N из M принято» и фильтр по
 * состоянию (их рисует сервер из того же чтения); «+ Документ» — тихая
 * кнопка, раскрывающая формы пункта и базового чек-листа (сплошной красный на
 * странице остаётся главному действию шапки). Строки — `DocumentRow`.
 *
 * Загрузка: файл уходит сразу после выбора (отдельной «Сохранить» нет), до
 * отправки — те же проверки, что у сервера; успех — только 201 с квитанцией
 * этого пункта, затем страница перечитывается. Итог живёт здесь, по id
 * пункта: строка с новой версией файла пересоздаётся, а слово остаётся.
 */
export function ProfileDocumentsClient({
  groups,
  historyGroups,
  uploadAccess,
  studentCaseId,
  createRequestId,
  baselineOptions = [],
  baselineOptionsUnavailable = false,
  baselineTemplatesAbsent = false,
  baselineChecklistRequestId = null,
  recognition = null,
  today,
  progress = null,
  filter = null,
  checklistEmpty = false,
  emptyText = null,
}: Readonly<{
  /** Пункты, которые показывает выбранный фильтр (без фильтра — все). */
  groups: readonly ActiveDocumentGroup[];
  historyGroups: readonly RemovedDocumentGroup[];
  uploadAccess: DocumentUploadAccess;
  studentCaseId: string | null;
  createRequestId: string | null;
  baselineOptions?: readonly BaselineChecklistOption[];
  /** The options read failed; distinct from an empty (nothing to apply) list. */
  baselineOptionsUnavailable?: boolean;
  /** The read succeeded with no template for this case, and none was applied. */
  baselineTemplatesAbsent?: boolean;
  baselineChecklistRequestId?: string | null;
  recognition?: DocumentRecognitionAccess | null;
  /** «Сегодня» по Бишкеку с сервера (даты строк). */
  today: string;
  /** «N из M принято» — только из прочитанного чек-листа; null — чисел нет. */
  progress?: ReactNode;
  /** Фильтр по состоянию (ссылки с числами); null — чек-лист пуст. */
  filter?: ReactNode;
  /** В чек-листе нет ни одного пункта: формы «+ Документ» открыты сразу. */
  checklistEmpty?: boolean;
  /** Одно пустое состояние списка: пустой чек-лист или пустой фильтр. */
  emptyText?: ReactNode;
}>) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [uploads, setUploads] = useState<Readonly<Record<string, DocumentUploadState>>>({});
  const inFlight = useRef(new Set<string>());
  const canChangeChecklist = uploadAccess === "allowed" && studentCaseId !== null && createRequestId !== null;
  const [addOpen, setAddOpen] = useState(checklistEmpty);

  function record(itemId: string, next: DocumentUploadResult | "sending", file: File | null) {
    const state: DocumentUploadState = next === "sending"
      ? { outcome: "sending", message: "Загружаем файл…", next: null, file }
      : { ...next, file: next.next === "retry" ? file : null };
    setUploads((current) => ({ ...current, [itemId]: state }));
  }

  async function upload(item: DocumentItem, file: File) {
    if (inFlight.current.has(item.id)) return;
    if (uploadAccess !== "allowed" || !item.uploadRequestId) {
      record(item.id, documentUploadFailure(403, null), null);
      return;
    }
    const problem = documentUploadFileProblem(file);
    if (problem) {
      record(item.id, problem, null);
      return;
    }

    inFlight.current.add(item.id);
    record(item.id, "sending", file);
    // Ровно два поля, как требует сервер: файл и ключ запроса этого пункта.
    const body = new FormData();
    body.set("file", file);
    body.set("request_id", item.uploadRequestId);
    try {
      const response = await fetch(`/api/v2/document-slots/${item.id}/versions`, {
        method: "POST",
        body,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.status !== 201) {
        record(item.id, documentUploadFailure(response.status, documentUploadErrorCode(payload)), file);
        return;
      }
      if (!documentUploadConfirmed(payload, item.id)) {
        record(item.id, documentUploadFailure(null, null), file);
        return;
      }
      record(item.id, DOCUMENT_UPLOAD_SAVED, null);
      router.refresh();
    } catch {
      record(item.id, documentUploadFailure(null, null), file);
    } finally {
      inFlight.current.delete(item.id);
    }
  }

  const baseline = uploadAccess === "allowed" && studentCaseId && baselineOptionsUnavailable ? (
    <BaselineChecklistUnavailable />
  ) : uploadAccess === "allowed" && studentCaseId && baselineChecklistRequestId &&
    baselineOptions.length > 0 ? (
      <ApplyBaselineChecklist
        key={baselineChecklistRequestId}
        studentCaseId={studentCaseId}
        options={baselineOptions}
        requestId={baselineChecklistRequestId}
      />
    ) : uploadAccess === "allowed" && studentCaseId && createRequestId && baselineTemplatesAbsent ? (
      // A quiet fact, not an error: the manual form right below is the way.
      <p className="t-body-compact text-fg-2"
        data-testid="v3-document-baseline-checklist-empty">
        Шаблонов чек-листа пока нет — документы добавляются вручную.
      </p>
    ) : null;

  return (
    <section aria-labelledby="case-documents-title" className="min-w-0 space-y-3" data-testid="v3-case-documents">
      <h2 id="case-documents-title" className="sr-only">Документы дела</h2>

      {progress || canChangeChecklist || studentCaseId ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">{progress}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {studentCaseId ? (
              <Link href={`/v3/messages?case=${studentCaseId}`} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
                Обсудить
              </Link>
            ) : null}
            {canChangeChecklist ? (
              <button
                type="button"
                className={`${QUEUE_SECONDARY} v3-choice`}
                aria-expanded={addOpen}
                aria-controls={ADD_REGION_ID}
                disabled={!hydrated}
                onClick={() => setAddOpen((open) => !open)}
                data-testid="v3-document-add-toggle"
              >
                <Icon name="plus" size={16} className="shrink-0" />
                <span><span className="sr-only">Добавить </span>Документ</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {uploadAccess !== "allowed" ? (
        <p className="t-body-compact text-fg-2" role="status">
          {ACCESS_MESSAGE[uploadAccess]}
        </p>
      ) : !canChangeChecklist ? (
        <p className="t-body-compact text-danger" role="status">
          Изменение чек-листа недоступно: сервер не подтвердил дело или команду.
        </p>
      ) : null}

      {canChangeChecklist && studentCaseId && createRequestId ? (
        <div id={ADD_REGION_ID} hidden={!addOpen} className="space-y-4 border-y border-border py-4" data-testid="v3-document-add">
          {baseline}
          <CreateChecklistItem
            key={createRequestId}
            studentCaseId={studentCaseId}
            requestId={createRequestId}
          />
        </div>
      ) : null}

      {filter}

      {groups.length === 0 ? (
        <p className="py-4 t-body-compact text-fg-2" data-testid="v3-document-empty">
          {emptyText ?? "В чек-листе пока нет документов."}
        </p>
      ) : (
        <ul className="@container/documents min-w-0">
          {groups.map((group) => (
            <li key={group.title}>
              <div className="flex items-center justify-between gap-3 border-b border-border pb-2 pt-3">
                <h3 className="t-caption text-fg-2">{group.title}</h3>
                <span className="t-caption tabular-nums text-fg-2">{group.items.length}</span>
              </div>
              <ul>
                {group.items.map((item) => (
                  <DocumentRow
                    key={`${item.id}:${item.currentVersionId ?? "none"}`}
                    item={item}
                    studentCaseId={studentCaseId}
                    uploadAccess={uploadAccess}
                    recognition={recognition}
                    today={today}
                    upload={uploads[item.id] ?? DOCUMENT_UPLOAD_IDLE}
                    onUpload={(target, file) => void upload(target, file)}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {recognition ? <DocumentRecognitionJobs key={recognition.studentCaseId}
        access={recognition} sourceVersionId={null} sourceReady={false} /> : null}

      <RemovedDocumentHistory groups={historyGroups} today={today} />
    </section>
  );
}
