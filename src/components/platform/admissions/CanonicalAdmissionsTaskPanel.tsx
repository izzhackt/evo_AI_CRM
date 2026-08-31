"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Card, btnCls, btnGhostCls, cn, inputCls, labelCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import {
  createCanonicalAdmissionsTaskAction,
  transitionCanonicalAdmissionsTaskAction,
  type CanonicalAdmissionsTaskActionState,
  type CanonicalAdmissionsTaskActionStatus,
} from "@/lib/server/canonical-admissions-task-actions";

export type CanonicalAdmissionsTaskView = Readonly<{
  taskId: string;
  studentCaseId: string;
  title: string;
  details: string | null;
  status: "open" | "completed" | "cancelled";
  dueAt: string | null;
  assignedRole: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByRole: string | null;
  closureReason: string | null;
  studentCaseStatus: "active" | "paused" | "closed";
  displayName: string;
  email: string | null;
  phone: string | null;
}>;

export type CanonicalAdmissionsTaskRequestIds = Readonly<
  Record<
    string,
    Readonly<{
      complete: string;
      cancel: string;
    }>
  >
>;

type Copy = Readonly<{
  panelTitle: string;
  panelDescription: string;
  queueTitle: string;
  queueDescription: string;
  createTitle: string;
  title: string;
  titleHint: string;
  details: string;
  detailsHint: string;
  dueDate: string;
  create: string;
  creating: string;
  empty: string;
  open: string;
  completed: string;
  cancelled: string;
  due: string;
  createdAt: string;
  version: string;
  complete: string;
  completing: string;
  cancelReason: string;
  cancelReasonHint: string;
  cancel: string;
  cancelling: string;
  case: string;
  caseActive: string;
  casePaused: string;
  caseClosed: string;
  openCase: string;
  contactAbsent: string;
  closureReason: string;
  moreTasks: string;
  state: Record<Exclude<CanonicalAdmissionsTaskActionStatus, "idle">, string>;
}>;

const COPY: Record<Locale, Copy> = {
  ru: {
    panelTitle: "Все задачи кейса",
    panelDescription:
      "Здесь показан полный список задач этого кейса из PostgreSQL, включая стартовые и созданные позже.",
    queueTitle: "Очередь задач Admissions",
    queueDescription:
      "Единая очередь задач всех переданных кейсов. Изменения сохраняются прямо в EVO V2 PostgreSQL.",
    createTitle: "Новая задача",
    title: "Название",
    titleHint: "Например: проверить перевод аттестата",
    details: "Детали",
    detailsHint: "Что именно нужно сделать",
    dueDate: "Срок (дата и время)",
    create: "Создать задачу",
    creating: "Создаём…",
    empty: "Задач пока нет.",
    open: "Открыта",
    completed: "Завершена",
    cancelled: "Отменена",
    due: "Срок",
    createdAt: "Создана",
    version: "Версия",
    complete: "Завершить",
    completing: "Завершаем…",
    cancelReason: "Причина отмены",
    cancelReasonHint: "Почему задачу больше не нужно выполнять",
    cancel: "Отменить задачу",
    cancelling: "Отменяем…",
    case: "Кейс",
    caseActive: "Активен",
    casePaused: "Приостановлен",
    caseClosed: "Закрыт",
    openCase: "Открыть кейс",
    contactAbsent: "Контакт не указан",
    closureReason: "Причина закрытия",
    moreTasks: "Показаны не все задачи. Уточните кейс в Student 360.",
    state: {
      saved: "Сохранено в EVO V2.",
      invalid: "Проверьте обязательные поля и допустимые значения.",
      forbidden: "У этой роли нет права изменять задачи Admissions.",
      stale: "Задача уже изменилась. Страница будет обновлена.",
      request_conflict:
        "Этот запрос уже использован с другими данными. Повторите действие.",
      unavailable: "PostgreSQL недоступен. Изменение не сохранено.",
    },
  },
  ky: {
    panelTitle: "Кейстин бардык тапшырмалары",
    panelDescription:
      "Бул жерде кейстин PostgreSQL базасындагы бардык тапшырмалары, анын ичинде баштапкы жана кийин түзүлгөндөрү көрсөтүлөт.",
    queueTitle: "Admissions тапшырмаларынын кезеги",
    queueDescription:
      "Өткөрүлгөн бардык кейстердин бирдиктүү тапшырмалар кезеги. Өзгөртүүлөр түз EVO V2 PostgreSQL базасына сакталат.",
    createTitle: "Жаңы тапшырма",
    title: "Аталышы",
    titleHint: "Мисалы: аттестаттын котормосун текшерүү",
    details: "Толук маалымат",
    detailsHint: "Эмне кылуу керек",
    dueDate: "Мөөнөт (күнү жана убактысы)",
    create: "Тапшырма түзүү",
    creating: "Түзүлүүдө…",
    empty: "Азырынча тапшырма жок.",
    open: "Ачык",
    completed: "Аяктады",
    cancelled: "Жокко чыгарылды",
    due: "Мөөнөт",
    createdAt: "Түзүлдү",
    version: "Версия",
    complete: "Аяктоо",
    completing: "Аякталууда…",
    cancelReason: "Жокко чыгаруу себеби",
    cancelReasonHint: "Эмне үчүн тапшырманы аткаруунун кереги жок",
    cancel: "Тапшырманы жокко чыгаруу",
    cancelling: "Жокко чыгарылууда…",
    case: "Кейс",
    caseActive: "Активдүү",
    casePaused: "Токтотулган",
    caseClosed: "Жабык",
    openCase: "Кейсти ачуу",
    contactAbsent: "Байланыш маалыматы жок",
    closureReason: "Жабуу себеби",
    moreTasks: "Бардык тапшырмалар көрсөтүлгөн жок. Кейсти Student 360 аркылуу тактаңыз.",
    state: {
      saved: "EVO V2 базасына сакталды.",
      invalid: "Милдеттүү талааларды жана маанилерди текшериңиз.",
      forbidden: "Бул роль Admissions тапшырмаларын өзгөртө албайт.",
      stale: "Тапшырма өзгөргөн. Барак жаңыртылат.",
      request_conflict:
        "Бул сурам башка маалымат үчүн колдонулган. Аракетти кайталаңыз.",
      unavailable: "PostgreSQL жеткиликсиз. Өзгөртүү сакталган жок.",
    },
  },
  en: {
    panelTitle: "All case tasks",
    panelDescription:
      "This is the complete PostgreSQL task list for the case, including starter tasks and tasks created later.",
    queueTitle: "Admissions task queue",
    queueDescription:
      "One task queue for every handed-off case. Changes are saved directly to EVO V2 PostgreSQL.",
    createTitle: "New task",
    title: "Title",
    titleHint: "For example: review the diploma translation",
    details: "Details",
    detailsHint: "What needs to be done",
    dueDate: "Due date and time",
    create: "Create task",
    creating: "Creating…",
    empty: "There are no tasks yet.",
    open: "Open",
    completed: "Completed",
    cancelled: "Cancelled",
    due: "Due",
    createdAt: "Created",
    version: "Version",
    complete: "Complete",
    completing: "Completing…",
    cancelReason: "Cancellation reason",
    cancelReasonHint: "Why this task is no longer needed",
    cancel: "Cancel task",
    cancelling: "Cancelling…",
    case: "Case",
    caseActive: "Active",
    casePaused: "Paused",
    caseClosed: "Closed",
    openCase: "Open case",
    contactAbsent: "No contact details",
    closureReason: "Closure reason",
    moreTasks: "Not every task is shown. Open the case in Student 360 for context.",
    state: {
      saved: "Saved to EVO V2.",
      invalid: "Check the required fields and allowed values.",
      forbidden: "This role cannot change Admissions tasks.",
      stale: "The task changed already. The page will refresh.",
      request_conflict:
        "This request was used with different data. Repeat the action.",
      unavailable: "PostgreSQL is unavailable. The change was not saved.",
    },
  },
};

function initialState(requestId: string): CanonicalAdmissionsTaskActionState {
  return Object.freeze({
    status: "idle" as const,
    requestId,
    taskId: null,
    studentCaseId: null,
    taskStatus: null,
    version: null,
    changedAt: null,
  });
}

function formatTimestamp(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(task: CanonicalAdmissionsTaskView, copy: Copy): string {
  if (task.status === "completed") return copy.completed;
  if (task.status === "cancelled") return copy.cancelled;
  return copy.open;
}

function caseStatusLabel(
  status: CanonicalAdmissionsTaskView["studentCaseStatus"],
  copy: Copy,
): string {
  if (status === "closed") return copy.caseClosed;
  if (status === "paused") return copy.casePaused;
  return copy.caseActive;
}

function ActionMessage({
  state,
  copy,
  testId,
}: Readonly<{
  state: CanonicalAdmissionsTaskActionState;
  copy: Copy;
  testId: string;
}>) {
  if (state.status === "idle") return null;
  return (
    <p
      role="status"
      data-testid={testId}
      className={cn(
        "text-xs",
        state.status === "saved" ? "text-ok" : "text-danger",
      )}
    >
      {copy.state[state.status]}
    </p>
  );
}

function CreateTaskForm({
  studentCaseId,
  requestId,
  copy,
}: Readonly<{
  studentCaseId: string;
  requestId: string;
  copy: Copy;
}>) {
  const router = useRouter();
  const [dueAt, setDueAt] = useState("");
  const [state, action, pending] = useActionState(
    createCanonicalAdmissionsTaskAction,
    initialState(requestId),
  );

  useEffect(() => {
    if (state.status !== "saved") return;
    router.refresh();
  }, [router, state.changedAt, state.status]);

  return (
    <form
      action={action}
      className="rounded-ctl border border-border bg-surface-2 p-4"
      data-testid="canonical-admissions-task-create-form"
    >
      <h3 className="text-sm font-semibold text-fg">{copy.createTitle}</h3>
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="due_at" value={dueAt} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          <span className={labelCls}>{copy.title}</span>
          <input
            name="title"
            required
            maxLength={200}
            placeholder={copy.titleHint}
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>{copy.dueDate}</span>
          <input
            type="datetime-local"
            step={60}
            className={inputCls}
            onChange={(event) => {
              const localDueAt = event.currentTarget.value;
              setDueAt(
                localDueAt ? new Date(localDueAt).toISOString() : "",
              );
            }}
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className={labelCls}>{copy.details}</span>
        <textarea
          name="details"
          maxLength={2000}
          rows={3}
          placeholder={copy.detailsHint}
          className={cn(inputCls, "h-auto resize-y py-2")}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btnCls}>
          {pending ? copy.creating : copy.create}
        </button>
        <ActionMessage
          state={state}
          copy={copy}
          testId="canonical-admissions-task-create-status"
        />
      </div>
    </form>
  );
}

function OpenTaskActions({
  task,
  requestIds,
  copy,
}: Readonly<{
  task: CanonicalAdmissionsTaskView;
  requestIds: Readonly<{ complete: string; cancel: string }>;
  copy: Copy;
}>) {
  const router = useRouter();
  const [completeState, completeAction, completing] = useActionState(
    transitionCanonicalAdmissionsTaskAction,
    initialState(requestIds.complete),
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    transitionCanonicalAdmissionsTaskAction,
    initialState(requestIds.cancel),
  );

  useEffect(() => {
    if (
      completeState.status === "saved" ||
      cancelState.status === "saved" ||
      completeState.status === "stale" ||
      cancelState.status === "stale"
    ) {
      router.refresh();
    }
  }, [
    cancelState.changedAt,
    cancelState.status,
    completeState.changedAt,
    completeState.status,
    router,
  ]);

  return (
    <div className="mt-4 grid gap-3 border-t border-border pt-4 lg:grid-cols-[auto_1fr]">
      <form
        action={completeAction}
        aria-label={`${copy.complete}: ${task.title}`}
        data-testid="canonical-admissions-task-complete-form"
      >
        <input type="hidden" name="request_id" value={completeState.requestId} />
        <input type="hidden" name="task_id" value={task.taskId} />
        <input type="hidden" name="expected_version" value={task.version} />
        <input type="hidden" name="to_status" value="completed" />
        <input type="hidden" name="reason" value="" />
        <button type="submit" disabled={completing || cancelling} className={btnCls}>
          {completing ? copy.completing : copy.complete}
        </button>
        <ActionMessage
          state={completeState}
          copy={copy}
          testId="canonical-admissions-task-complete-status"
        />
      </form>

      <form
        action={cancelAction}
        aria-label={`${copy.cancel}: ${task.title}`}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        data-testid="canonical-admissions-task-cancel-form"
      >
        <input type="hidden" name="request_id" value={cancelState.requestId} />
        <input type="hidden" name="task_id" value={task.taskId} />
        <input type="hidden" name="expected_version" value={task.version} />
        <input type="hidden" name="to_status" value="cancelled" />
        <label className="min-w-0 flex-1">
          <span className={labelCls}>{copy.cancelReason}</span>
          <input
            name="reason"
            required
            maxLength={2000}
            placeholder={copy.cancelReasonHint}
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          disabled={cancelling || completing}
          className={btnGhostCls}
        >
          {cancelling ? copy.cancelling : copy.cancel}
        </button>
        <ActionMessage
          state={cancelState}
          copy={copy}
          testId="canonical-admissions-task-cancel-status"
        />
      </form>
    </div>
  );
}

function TaskItem({
  task,
  locale,
  copy,
  requestIds,
  showCase,
}: Readonly<{
  task: CanonicalAdmissionsTaskView;
  locale: Locale;
  copy: Copy;
  requestIds: Readonly<{ complete: string; cancel: string }>;
  showCase: boolean;
}>) {
  const headingId = `canonical-admissions-task-${task.taskId}`;
  return (
    <li
      className="rounded-ctl border border-border bg-surface p-4"
      data-testid="canonical-admissions-task"
    >
      <article aria-labelledby={headingId}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={headingId} className="break-words text-sm font-semibold text-fg">
              {task.title}
            </h3>
            {task.details ? (
              <p className="mt-1 max-w-[60ch] whitespace-pre-wrap text-sm leading-5 text-fg-3">
                {task.details}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold",
              task.status === "completed"
                ? "bg-ok-weak text-ok"
                : task.status === "cancelled"
                  ? "bg-surface-2 text-fg-3"
                  : "bg-info-weak text-info",
            )}
          >
            {statusLabel(task, copy)}
          </span>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-fg-3">
          <div>
            <dt className="inline font-semibold">{copy.createdAt}: </dt>
            <dd className="inline">{formatTimestamp(task.createdAt, locale)}</dd>
          </div>
          {task.dueAt ? (
            <div>
              <dt className="inline font-semibold">{copy.due}: </dt>
              <dd className="inline">{formatTimestamp(task.dueAt, locale)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline font-semibold">{copy.version}: </dt>
            <dd className="inline">{task.version}</dd>
          </div>
        </dl>

        {showCase ? (
          <div className="mt-3 rounded-ctl bg-surface-2 p-3 text-xs text-fg-2">
            <p className="font-medium text-fg">
              {copy.case}: {task.displayName}
            </p>
            <p className="mt-1 text-fg-3">
              {caseStatusLabel(task.studentCaseStatus, copy)} ·{" "}
              {task.email ?? task.phone ?? copy.contactAbsent}
            </p>
            <Link
              href={`/clients/${task.studentCaseId}`}
              className="mt-2 inline-flex min-h-11 items-center rounded-ctl px-1 font-medium text-accent underline-offset-2 hover:underline"
            >
              {copy.openCase}
            </Link>
          </div>
        ) : null}

        {task.closureReason ? (
          <p className="mt-3 text-xs text-fg-3">
            <strong>{copy.closureReason}:</strong> {task.closureReason}
          </p>
        ) : null}

        {task.status === "open" && task.studentCaseStatus === "active" ? (
          <OpenTaskActions task={task} requestIds={requestIds} copy={copy} />
        ) : null}
      </article>
    </li>
  );
}

export function CanonicalAdmissionsTaskPanel({
  locale,
  tasks,
  transitionRequestIds,
  create,
  showCase = false,
  hasNext = false,
}: Readonly<{
  locale: Locale;
  tasks: readonly CanonicalAdmissionsTaskView[];
  transitionRequestIds: CanonicalAdmissionsTaskRequestIds;
  create?: Readonly<{ studentCaseId: string; requestId: string }>;
  showCase?: boolean;
  hasNext?: boolean;
}>) {
  const copy = COPY[locale];
  return (
    <section
      className="space-y-4"
      aria-labelledby="canonical-admissions-task-panel-title"
      data-testid="canonical-admissions-task-panel"
    >
      <Card className="shadow-none">
        <div className="border-b border-border pb-4">
          <h2
            id="canonical-admissions-task-panel-title"
            className="text-md font-semibold text-fg"
          >
            {showCase ? copy.queueTitle : copy.panelTitle}
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm leading-5 text-fg-3">
            {showCase ? copy.queueDescription : copy.panelDescription}
          </p>
        </div>

        {create ? (
          <div className="mt-4">
            <CreateTaskForm
              studentCaseId={create.studentCaseId}
              requestId={create.requestId}
              copy={copy}
            />
          </div>
        ) : null}

        {tasks.length === 0 ? (
          <p className="mt-4 text-sm text-fg-3">{copy.empty}</p>
        ) : (
          <ul
            role="list"
            className="mt-4 grid gap-3"
            data-testid="canonical-admissions-task-list"
          >
            {tasks.map((task) => {
              const requestIds = transitionRequestIds[task.taskId];
              if (!requestIds) return null;
              return (
                <TaskItem
                  key={task.taskId}
                  task={task}
                  locale={locale}
                  copy={copy}
                  requestIds={requestIds}
                  showCase={showCase}
                />
              );
            })}
          </ul>
        )}

        {hasNext ? (
          <p className="mt-4 text-xs text-warn" role="status">
            {copy.moreTasks}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
