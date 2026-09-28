"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { Icon } from "@/components/icons";
import { btnGhostCls, fieldLabelCls, inputCls } from "@/components/ui";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { useAnchoredPopover } from "@/components/v3/queue/useAnchoredPopover";
import { MENU_ITEM } from "@/components/v3/students/DocsRowMenu";
import {
  changePlatformDocumentSlotMetadataAction,
  removePlatformDocumentSlotAction,
  setPlatformDocumentCaseLinkAction,
  type PlatformDocumentCaseLinkActionState,
  type PlatformDocumentChecklistActionState,
} from "@/lib/platform-document-checklist-actions";
import { reviewPlatformDocumentAction, type DocumentReviewOutcome } from "@/lib/platform-document-review-action";
import type { PlatformDocumentReviewDecision, PlatformDocumentSlotStatus } from "@/lib/platform-private-documents";

import { caseMomentLabel } from "./case-work-view";
import { ChecklistFeedback, useRefreshAfterSave } from "./DocumentChecklistFeedback";
import { DocumentPreviewButton } from "./DocumentPreviewButton";
import { DocumentRecognitionJobs } from "./DocumentRecognitionJobs";
import { DOCUMENT_UPLOAD_HINT, DOCUMENT_UPLOAD_TYPES, type DocumentUploadState } from "./document-upload";
import { documentStatusChip } from "./documents-view";
import type {
  DocumentCaseLinkTarget,
  DocumentItem,
  DocumentRecognitionAccess,
  DocumentUploadAccess,
} from "./document-types";

/**
 * Строка чек-листа (Э8.1): название · файл · одно слово состояния · дата
 * текущей версии · «Просмотреть» · решение в строке. Редкое — в «⋯»:
 * «Скачать», «Заменить файл», «Изменить пункт», «Связи», «Убрать»,
 * «Распознавание»; выбранное раскрывается под строкой, по одному.
 *
 * Строка — своя сетка по ширине области (container query `documents`), как
 * таблица EVO Docs: колонки фиксированные, потому что у каждой строки своя
 * сетка. Уже 52rem — стопка: название и «⋯», состояние и дата, действия.
 */
const ROW_GRID = "grid grid-cols-[auto_minmax(0,1fr)_2.75rem] items-center gap-x-3 gap-y-2 [grid-template-areas:'name_name_menu'_'status_date_date'_'actions_actions_actions'] @min-[52rem]/documents:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_22rem_2.75rem] @min-[52rem]/documents:[grid-template-areas:'name_status_date_actions_menu']";

/** Видимая подпись скрытого поля файла: выглядит как тихая кнопка, фокус — у поля внутри. */
const UPLOAD_LABEL = "v3-raised inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring has-[:disabled]:cursor-wait has-[:disabled]:border-border has-[:disabled]:bg-surface-2 has-[:disabled]:text-fg-3";

const TEXT_BUTTON = "inline-flex min-h-11 items-center rounded-nav px-2 t-label text-fg-2 underline underline-offset-4 hover:text-fg";

type Panel = "return" | "edit" | "links" | "remove" | "recognition";

const subscribeNothing = () => () => {};

/**
 * true после гидратации. До неё обработчиков ещё нет: выбранный файл или
 * нажатие потерялись бы молча, поэтому такие элементы до неё недоступны.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

const PANEL_TITLE: Readonly<Record<Exclude<Panel, "recognition">, string>> = {
  return: "Вернуть студенту",
  edit: "Изменить пункт",
  links: "Связи",
  remove: "Убрать из чек-листа",
};

const REVIEW_MESSAGES: Readonly<Record<DocumentReviewOutcome, string>> = {
  saved: "Решение сохранено. Данные документа обновляются.",
  invalid: "Укажите причину для студента — до 2000 символов.",
  forbidden: "Проверка недоступна: проверьте права на дело и выбранную роль.",
  stale: "Документ уже изменён или проверен. Обновите данные и проверьте актуальную версию.",
  request_conflict: "Этот запрос уже использован. Обновите данные перед новым решением.",
  file_unavailable: "Файл ещё недоступен для проверки. Обновите данные после завершения загрузки и проверки файла.",
  notification_unavailable: "Сервер не подтвердил решение: уведомление студента недоступно. Нужны активный доступ студента к делу и включённые уведомления кабинета.",
  unavailable: "Сервер не подтвердил результат. Повторите тот же запрос: решение и причина сохранены.",
};

/** У «Принять» причины нет: отказ сервера в данных команды — устаревшая страница, а не причина. */
const APPROVE_INVALID = "Решение не принято сервером. Обновите страницу.";

type ReviewAttempt = Readonly<{ decision: PlatformDocumentReviewDecision; reason: string }>;

type ReviewState = Readonly<{
  pending: boolean;
  outcome: DocumentReviewOutcome | null;
  /** Решение последней попытки: слово итога «invalid» у «Принять» и у «Вернуть…» разное. */
  decision: PlatformDocumentReviewDecision | null;
  /** Попытка без подтверждённого ответа: «Повторить» отправляет её же с тем же ключом. */
  attempt: ReviewAttempt | null;
}>;

const REVIEW_IDLE: ReviewState = Object.freeze({ pending: false, outcome: null, decision: null, attempt: null });

function CaseLinkSummary({ item }: Readonly<{ item: DocumentItem }>) {
  const linkedTargets = item.caseLinkTargets.filter((target) => target.linked);
  if (linkedTargets.length === 0) return null;
  return (
    <p className="t-meta text-fg-2" data-testid="v3-document-linked-targets">
      Связано:{" "}
      {linkedTargets.map((target, index) => (
        <span key={`${target.kind}:${target.id}`}>{index > 0 ? " · " : null}{target.label}</span>
      ))}
    </p>
  );
}

function CaseLinkTargetForm({
  item,
  studentCaseId,
  target,
}: Readonly<{
  item: DocumentItem;
  studentCaseId: string;
  target: DocumentCaseLinkTarget;
}>) {
  const requestId = target.requestId ?? "";
  const initialState: PlatformDocumentCaseLinkActionState = {
    status: "idle",
    requestId,
    documentSlotId: item.id,
    targetKind: target.kind,
    targetId: target.id,
    version: null,
  };
  const [state, action, pending] = useActionState(
    setPlatformDocumentCaseLinkAction,
    initialState,
  );
  useRefreshAfterSave(state.status);
  const waitingForCanonicalRefresh = state.status === "saved"
    && state.version !== String(item.version);
  const locked = pending || waitingForCanonicalRefresh || requestId.length === 0;

  return (
    <form
      action={action}
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      aria-busy={pending}
      data-testid="v3-document-case-link-form"
      data-target-kind={target.kind}
      data-linked={target.linked}
    >
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="document_slot_id" value={item.id} />
      <input type="hidden" name="target_kind" value={target.kind} />
      <input type="hidden" name="target_id" value={target.id} />
      <input type="hidden" name="enabled" value={target.linked ? "false" : "true"} />
      <input type="hidden" name="expected_version" value={item.version} />
      <input type="hidden" name="request_id" value={state.requestId || requestId} />
      <label className="flex min-h-11 min-w-0 items-center gap-2 t-body-compact text-fg sm:col-span-2">
        <input
          type="checkbox"
          className="size-4 shrink-0 rounded border-control-edge accent-fg"
          checked={target.linked}
          readOnly
          disabled={locked}
        />
        <span className="min-w-0 truncate">{target.label}</span>
      </label>
      <label className="grid gap-1">
        <span className={fieldLabelCls}>Причина изменения</span>
        <input
          required
          name="reason"
          className={inputCls}
          maxLength={1000}
          placeholder="Например: документ нужен для подачи"
          disabled={locked}
        />
      </label>
      <button type="submit" className={QUEUE_SECONDARY} disabled={locked}>
        {pending ? "Сохраняем…" : target.linked ? "Убрать связь" : "Связать"}
      </button>
      <div className="sm:col-span-2">
        <ChecklistFeedback state={state} />
      </div>
    </form>
  );
}

function ChecklistItemEdit({
  item,
  studentCaseId,
  requestId,
}: Readonly<{
  item: DocumentItem;
  studentCaseId: string;
  requestId: string;
}>) {
  const baseVersion = String(item.version);
  const initialState: PlatformDocumentChecklistActionState = {
    status: "idle",
    requestId,
    documentSlotId: item.id,
    version: baseVersion,
  };
  const [state, action, pending] = useActionState(
    changePlatformDocumentSlotMetadataAction,
    initialState,
  );
  useRefreshAfterSave(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form
      action={action}
      className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] md:items-end"
      aria-busy={pending}
      data-testid="v3-document-checklist-edit"
    >
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="document_slot_id" value={item.id} />
      <input type="hidden" name="expected_version" value={state.version ?? baseVersion} />
      <input type="hidden" name="request_id" value={state.requestId || requestId} />
      <input type="hidden" name="reason" value="Обновление пункта чек-листа сотрудником" />
      <label>
        <span className={fieldLabelCls}>Название</span>
        <input required name="label" maxLength={500} className={inputCls} defaultValue={item.name} disabled={locked} />
      </label>
      <label>
        <span className={fieldLabelCls}>Группа</span>
        <input required name="group_label" maxLength={200} className={inputCls} defaultValue={item.groupLabel} disabled={locked} />
      </label>
      <button type="submit" className={QUEUE_CONFIRM} disabled={locked}>
        {pending ? "Сохраняем…" : "Сохранить"}
      </button>
      <div className="md:col-span-3">
        <ChecklistFeedback state={state} />
      </div>
    </form>
  );
}

function ChecklistItemRemove({
  item,
  studentCaseId,
  requestId,
}: Readonly<{
  item: DocumentItem;
  studentCaseId: string;
  requestId: string;
}>) {
  const baseVersion = String(item.version);
  const initialState: PlatformDocumentChecklistActionState = {
    status: "idle",
    requestId,
    documentSlotId: item.id,
    version: baseVersion,
  };
  const [state, action, pending] = useActionState(
    removePlatformDocumentSlotAction,
    initialState,
  );
  useRefreshAfterSave(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form
      action={action}
      className="flex flex-wrap items-center justify-between gap-3"
      aria-busy={pending}
      data-testid="v3-document-checklist-remove"
    >
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="document_slot_id" value={item.id} />
      <input type="hidden" name="expected_version" value={state.version ?? baseVersion} />
      <input type="hidden" name="request_id" value={state.requestId || requestId} />
      <input type="hidden" name="reason" value="Удаление пункта из активного чек-листа сотрудником" />
      <p className="t-body-compact text-fg-2">Пункт уйдёт из чек-листа. Файлы сохранятся в истории дела.</p>
      <button type="submit" className={QUEUE_CONFIRM} disabled={locked}>
        {pending ? "Убираем…" : "Убрать из чек-листа"}
      </button>
      <div className="w-full">
        <ChecklistFeedback state={state} />
      </div>
    </form>
  );
}

/**
 * «⋯» строки — тот же приём, что у строки EVO Docs (`DocsRowMenu`): popover
 * API в верхнем слое, место — у своей кнопки; выбор пункта его закрывает.
 */
function DocumentRowMenu({ name, children }: Readonly<{ name: string; children: (close: () => void) => ReactNode }>) {
  const menu = useAnchoredPopover("end");
  const close = () => document.getElementById(menu.popoverId)?.hidePopover();
  return (
    <>
      <button
        id={menu.triggerId}
        type="button"
        popoverTarget={menu.popoverId}
        style={menu.triggerStyle}
        aria-label={`Ещё по документу: ${name}`}
        className="grid size-11 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
        data-testid="v3-document-menu"
      >
        <Icon name="more-horizontal" size={20} />
      </button>
      <div
        id={menu.popoverId}
        popover="auto"
        style={menu.popoverStyle}
        role="group"
        aria-label={`Ещё по документу: ${name}`}
        className="v3-anchored v3-anchored-end w-60 rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg"
      >
        {children(close)}
      </div>
    </>
  );
}

export function DocumentRow({
  item,
  studentCaseId,
  uploadAccess,
  recognition,
  today,
  upload,
  onUpload,
  onReviewSaved,
}: Readonly<{
  item: DocumentItem;
  studentCaseId: string | null;
  uploadAccess: DocumentUploadAccess;
  recognition: DocumentRecognitionAccess | null;
  /** «Сегодня» по Бишкеку с сервера: дата строки без года текущего года. */
  today: string;
  upload: DocumentUploadState;
  /** Загрузка идёт у списка: её итог переживает новую версию строки. */
  onUpload: (item: DocumentItem, file: File) => void;
  /** Решение сохранено: под фильтром список назовёт, куда ушла строка. */
  onReviewSaved: (item: DocumentItem, status: PlatformDocumentSlotStatus) => void;
}>) {
  const router = useRouter();
  const hydrated = useHydrated();
  const reasonId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [reason, setReason] = useState("");
  // Ключ решения — один на версию файла (строка пересоздаётся с новой версией):
  // повтор после потерянного ответа идёт с тем же ключом.
  const [reviewRequestId] = useState(item.presence === "present" ? item.reviewRequestId : null);
  const [review, setReview] = useState<ReviewState>(REVIEW_IDLE);
  const reviewSending = useRef(false);

  useEffect(() => {
    if (panel && panel !== "recognition") panelHeadingRef.current?.focus();
  }, [panel]);

  // Текущая версия файла; null — файла нет (сужает тип, в отличие от булева флага).
  const current = item.presence === "present" ? item : null;
  const present = current !== null;
  const chip = documentStatusChip(item.status);
  const sending = upload.outcome === "sending";
  const uploadRequestId = uploadAccess === "allowed" && item.status !== "approved" ? item.uploadRequestId : null;
  const uploadIdMissing = uploadAccess === "allowed" && item.status !== "approved" && item.uploadRequestId === null;
  const canEditItem = uploadAccess === "allowed" && studentCaseId !== null
    && item.metadataRequestId !== null && item.removalRequestId !== null;
  // Решать можно, пока и живой пункт выдаёт ключ решения (текущая версия ещё
  // на проверке): после перечтения с чужим решением кнопки уходят, а не ждут отказа.
  const reviewable = uploadAccess === "allowed" && studentCaseId !== null && current !== null
    && current.reviewRequestId !== null && reviewRequestId !== null;
  const deciding = reviewable && review.outcome !== "saved";
  // Перечитанный пункт уже в новом состоянии (его называет чип строки): «сохранено» больше не нужно.
  const reviewOutcome = review.outcome === "saved" && item.status !== "submitted" ? null : review.outcome;
  const approveInvalid = review.outcome === "invalid" && review.decision === "approved";
  const reviewStale = review.outcome === "stale" || review.outcome === "request_conflict";
  const reviewUncertain = review.outcome === "unavailable" && review.attempt !== null;
  const reviewLocked = !hydrated || review.pending || reviewUncertain || reviewStale || review.outcome === "saved";

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    // Тот же файл можно выбрать снова: значение поля очищается сразу.
    event.currentTarget.value = "";
    if (file) onUpload(item, file);
  }

  async function decide(attempt: ReviewAttempt) {
    if (!current || !studentCaseId || !reviewRequestId || reviewSending.current) return;
    if (review.outcome === "saved" || reviewStale) return;
    reviewSending.current = true;
    setReview({ pending: true, outcome: null, decision: attempt.decision, attempt });
    const form = new FormData();
    form.set("student_case_id", studentCaseId);
    form.set("document_slot_id", item.id);
    form.set("document_version_id", current.currentVersionId);
    form.set("request_id", reviewRequestId);
    form.set("decision", attempt.decision);
    form.set("reason", attempt.decision === "approved" ? "" : attempt.reason);
    try {
      const result = await reviewPlatformDocumentAction(form);
      setReview({ pending: false, outcome: result, decision: attempt.decision, attempt: result === "unavailable" ? attempt : null });
      if (result === "saved") {
        setPanel(null);
        onReviewSaved(item, attempt.decision);
        router.refresh();
      }
    } catch {
      setReview({ pending: false, outcome: "unavailable", decision: attempt.decision, attempt });
    } finally {
      reviewSending.current = false;
    }
  }

  function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const decision: PlatformDocumentReviewDecision = submitter instanceof HTMLButtonElement && submitter.value === "rejected"
      ? "rejected" : "correction_required";
    void decide({ decision, reason });
  }

  const menuItems = (close: () => void) => (
    <>
      {current?.downloadReady ? (
        <a
          href={`/api/v2/document-versions/${current.currentVersionId}/download`}
          onClick={close}
          className={MENU_ITEM}
          data-testid="v3-document-download"
        >
          Скачать
        </a>
      ) : null}
      {present && uploadRequestId ? (
        <button type="button" className={MENU_ITEM} disabled={!hydrated || sending} onClick={() => { close(); fileRef.current?.click(); }}>
          Заменить файл
        </button>
      ) : null}
      {canEditItem ? (
        <button type="button" className={MENU_ITEM} disabled={!hydrated} onClick={() => { close(); setPanel("edit"); }}>Изменить пункт</button>
      ) : null}
      {canEditItem && item.caseLinkTargets.length > 0 ? (
        <button type="button" className={MENU_ITEM} disabled={!hydrated} onClick={() => { close(); setPanel("links"); }}>Связи</button>
      ) : null}
      {canEditItem ? (
        <button type="button" className={MENU_ITEM} disabled={!hydrated} onClick={() => { close(); setPanel("remove"); }}>Убрать из чек-листа…</button>
      ) : null}
      {recognition && present ? (
        <button type="button" className={MENU_ITEM} disabled={!hydrated} onClick={() => { close(); setPanel((open) => open === "recognition" ? null : "recognition"); }}>
          Распознавание
        </button>
      ) : null}
    </>
  );
  const hasMenu = current?.downloadReady === true || (present && uploadRequestId !== null) || canEditItem
    || (recognition !== null && present);

  return (
    <li
      id={`document-${item.id}`}
      className="scroll-mt-4 border-b border-border py-3"
      aria-busy={sending || review.pending}
      data-testid="v3-document-item"
      data-document-presence={item.presence}
      data-document-intent={item.intentKind}
      data-document-slot-version={item.version}
      data-document-status={item.status}
    >
      <div className={ROW_GRID}>
        <div className="min-w-0 space-y-0.5 [grid-area:name]">
          <p className="break-words t-item text-fg">{item.name}</p>
          {current ? (
            <p className="truncate t-meta text-fg-2" title={current.currentFilename}>
              {current.currentFilename}{current.currentVersionNumber > 1 ? ` · версия ${current.currentVersionNumber}` : null}
            </p>
          ) : null}
          {current?.latestReview?.reason ? (
            <p className="break-words t-meta text-fg-2">Причина для студента: <span className="text-fg">{current.latestReview.reason}</span></p>
          ) : null}
          <CaseLinkSummary item={item} />
          {current && !current.downloadReady ? (
            <p className="t-meta text-fg-2" role="status">
              {deciding
                ? "Файл ещё проверяется: принять можно после проверки, вернуть студенту — уже сейчас."
                : "Файл есть, но скачивание ещё не подтверждено хранилищем."}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 [grid-area:status]">
          {chip ? <StatusChip label={chip.label} tone={chip.tone} /> : null}
        </div>
        <div className="min-w-0 [grid-area:date]">
          {current ? (
            <span className="t-meta text-fg-2">
              <time dateTime={current.currentVersionCreatedAt} className="font-mono tabular-nums">
                {caseMomentLabel(current.currentVersionCreatedAt, today)}
              </time>
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 [grid-area:actions]">
          {current?.downloadReady ? (
            <DocumentPreviewButton key={current.currentVersionId} versionId={current.currentVersionId} filename={current.currentFilename} versionNumber={current.currentVersionNumber} />
          ) : deciding ? (
            // Место «Просмотреть» держится, пока файл проверяется: «Принять» и «Вернуть…» — там же, где у соседних строк.
            <span aria-hidden="true" className="invisible hidden @min-[52rem]/documents:inline-flex" data-testid="v3-document-preview-slot">
              <span className={`${btnGhostCls} min-h-11`}>Просмотреть</span>
            </span>
          ) : null}
          {deciding ? (
            <>
              <button
                type="button"
                className={QUEUE_CONFIRM}
                disabled={reviewLocked || !item.downloadReady}
                onClick={() => void decide({ decision: "approved", reason: "" })}
                data-testid="v3-document-approve"
              >
                {review.pending && review.attempt?.decision === "approved" ? "Принимаем…" : "Принять"}
              </button>
              <button
                type="button"
                className={`${QUEUE_SECONDARY} v3-choice`}
                disabled={reviewLocked}
                aria-expanded={panel === "return"}
                onClick={() => setPanel((open) => open === "return" ? null : "return")}
                data-testid="v3-document-return"
              >
                Вернуть…
              </button>
            </>
          ) : null}
          {!present && uploadRequestId ? (
            <form
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
              onSubmit={(event) => event.preventDefault()}
              data-testid="v3-document-upload-form"
            >
              <input type="hidden" name="request_id" value={uploadRequestId} />
              <label className={UPLOAD_LABEL}>
                <input
                  ref={fileRef}
                  name="file"
                  type="file"
                  accept={DOCUMENT_UPLOAD_TYPES.join(",")}
                  className="sr-only"
                  disabled={!hydrated || sending}
                  onChange={choose}
                />
                <Icon name="upload" size={16} className="shrink-0" />
                {sending ? "Загружаем…" : "Загрузить файл"}
              </label>
              <span className="t-meta text-fg-2">{DOCUMENT_UPLOAD_HINT}</span>
            </form>
          ) : null}
        </div>
        <div className="flex justify-end self-start [grid-area:menu] @min-[52rem]/documents:self-center">
          {hasMenu ? <DocumentRowMenu name={item.name}>{menuItems}</DocumentRowMenu> : null}
        </div>
      </div>

      {present && uploadRequestId ? (
        // «⋯» → «Заменить файл» открывает выбор этого поля; файл уходит сразу после выбора.
        <form hidden onSubmit={(event) => event.preventDefault()} data-testid="v3-document-upload-form">
          <input type="hidden" name="request_id" value={uploadRequestId} />
          <input
            ref={fileRef}
            name="file"
            type="file"
            tabIndex={-1}
            accept={DOCUMENT_UPLOAD_TYPES.join(",")}
            disabled={!hydrated || sending}
            onChange={choose}
          />
        </form>
      ) : null}

      {uploadIdMissing ? (
        <p className="mt-2 t-body-compact text-danger" role="status">
          Загрузка недоступна: сервер не выдал безопасный идентификатор команды.
        </p>
      ) : null}

      {upload.message ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p
            // Пока файл уходит, подпись «Загрузить файл» сама говорит «Загружаем…»; строка остаётся для читалки.
            className={upload.outcome === "sending" && !present ? "sr-only"
              : `t-body-compact ${upload.outcome === "saved" ? "text-ok" : upload.outcome === "sending" ? "text-fg-2" : "text-danger"}`}
            role="status"
            data-testid="v3-document-upload-status"
            data-outcome={upload.outcome}
          >
            {upload.message}
          </p>
          {upload.next === "retry" && upload.file ? (
            <button type="button" className={QUEUE_SECONDARY} onClick={() => upload.file && onUpload(item, upload.file)}>
              Повторить
            </button>
          ) : upload.next === "refresh" ? (
            <button type="button" className={TEXT_BUTTON} onClick={() => router.refresh()}>Обновить страницу</button>
          ) : null}
        </div>
      ) : null}

      {reviewOutcome ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p role="status" className={`break-words t-body-compact ${reviewOutcome === "saved" ? "text-ok" : "text-danger"}`}>
            {approveInvalid ? APPROVE_INVALID : REVIEW_MESSAGES[reviewOutcome]}
          </p>
          {approveInvalid ? (
            <button type="button" className={TEXT_BUTTON} onClick={() => router.refresh()}>Обновить страницу</button>
          ) : reviewUncertain && review.attempt ? (
            <button type="button" className={QUEUE_SECONDARY} disabled={review.pending} onClick={() => review.attempt && void decide(review.attempt)}>
              Повторить тот же запрос
            </button>
          ) : reviewStale || review.outcome === "file_unavailable" ? (
            <button
              type="button"
              className={TEXT_BUTTON}
              onClick={() => {
                // A deliberate stale-command recovery discards its identity. A normal
                // RSC refresh keeps the identity and draft for uncertain retries.
                if (reviewStale) window.location.reload();
                else router.refresh();
              }}
            >
              Обновить данные
            </button>
          ) : null}
        </div>
      ) : null}

      {panel === "recognition" && recognition && current ? (
        <DocumentRecognitionJobs key={current.currentVersionId} access={recognition} initiallyOpen
          sourceVersionId={current.currentVersionId} sourceReady={current.downloadReady} />
      ) : null}

      {panel && panel !== "recognition" ? (
        <div className="mt-3 max-w-3xl space-y-3 border-t border-border pt-2" data-testid="v3-document-panel" data-panel={panel}>
          <div className="flex items-center justify-between gap-3">
            <h4 ref={panelHeadingRef} tabIndex={-1} className="t-item text-fg">{PANEL_TITLE[panel]}</h4>
            <button
              type="button"
              aria-label={`Закрыть: ${PANEL_TITLE[panel]}`}
              className="grid size-11 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
              onClick={() => setPanel(null)}
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          {panel === "return" && reviewable ? (
            <form onSubmit={submitReturn} className="grid min-w-0 gap-3" aria-busy={review.pending} data-testid="v3-document-return-form">
              <div>
                <label htmlFor={reasonId} className={fieldLabelCls}>Что нужно исправить</label>
                <textarea
                  id={reasonId}
                  name="reason"
                  className={`${inputCls} h-auto min-h-24 resize-y py-2`}
                  value={reason}
                  required
                  maxLength={2000}
                  disabled={reviewLocked}
                  aria-describedby={`${reasonId}-help`}
                  onChange={(event) => setReason(event.target.value)}
                />
                <p id={`${reasonId}-help`} className="mt-1 t-meta text-fg-2">Причину увидит студент в кабинете. До 2000 символов.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" value="correction_required" className={QUEUE_CONFIRM} disabled={reviewLocked}>
                  {review.pending && review.attempt?.decision === "correction_required" ? "Возвращаем…" : "Вернуть на исправление"}
                </button>
                <button type="submit" value="rejected" className={QUEUE_SECONDARY} disabled={reviewLocked}>
                  {review.pending && review.attempt?.decision === "rejected" ? "Отклоняем…" : "Отклонить"}
                </button>
              </div>
            </form>
          ) : null}

          {panel === "edit" && canEditItem && studentCaseId && item.metadataRequestId ? (
            <ChecklistItemEdit key={item.version} item={item} studentCaseId={studentCaseId} requestId={item.metadataRequestId} />
          ) : null}

          {panel === "links" && canEditItem && studentCaseId ? (
            <div className="space-y-4" data-testid="v3-document-case-links">
              {item.caseLinkTargets.map((target) => (
                <CaseLinkTargetForm
                  key={`${target.kind}:${target.id}:${item.version}`}
                  item={item}
                  studentCaseId={studentCaseId}
                  target={target}
                />
              ))}
            </div>
          ) : null}

          {panel === "remove" && canEditItem && studentCaseId && item.removalRequestId ? (
            <ChecklistItemRemove key={item.version} item={item} studentCaseId={studentCaseId} requestId={item.removalRequestId} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
