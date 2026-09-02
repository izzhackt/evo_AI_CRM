"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";

import {
  Badge,
  btnCls,
  btnGhostCls,
  cn,
  inputCls,
  labelCls,
} from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  changePlatformAdmissionsTaskAction,
  createPlatformAdmissionsTaskAction,
} from "@/lib/platform-admissions-task-actions";
import {
  PLATFORM_CASE_TASK_PRIORITIES,
  PLATFORM_CASE_TASK_STATUSES,
  type PlatformAdmissionsTask,
  type PlatformAdmissionsTaskAssignee,
  type PlatformAdmissionsTaskQueueRow,
} from "@/lib/platform-admissions-task-contract";

type TaskView = PlatformAdmissionsTask | PlatformAdmissionsTaskQueueRow;
type MutationOutcome = "saved" | "invalid" | "unavailable";

export type PlatformAdmissionsTaskRequestIds = Readonly<{
  create: string;
  changes: Readonly<Record<string, string>>;
}>;

export type PlatformAdmissionsTaskFeedback = Readonly<{
  outcome: MutationOutcome;
  operation: "create" | "change" | null;
  subjectId: string | null;
}>;

const COPY = {
  ru: {
    title: "Задачи Admissions",
    description: "Ответственный, срок и статус хранятся в едином кейсе Supabase.",
    create: "Создать задачу",
    taskType: "Тип задачи",
    taskTitle: "Название",
    assignee: "Ответственный",
    priority: "Приоритет",
    dueAt: "Срок (UTC)",
    status: "Статус",
    studentVisible: "Видимость студенту",
    visible: "Видна",
    hidden: "Скрыта",
    save: "Сохранить",
    saving: "Сохраняем…",
    edit: "Изменить задачу",
    empty: "Задач пока нет.",
    more: "Показаны первые 50 задач. Продолжите работу в конкретном Student 360.",
    case: "Student 360",
    dueMissing: "Срок не задан",
    saved: "Изменения сохранены.",
    invalid: "Данные задачи отклонены. Проверьте все поля.",
    unavailable: "Задача не изменена: Supabase не подтвердил операцию.",
    statusLabels: {
      open: "Открыта",
      in_progress: "В работе",
      blocked: "Заблокирована",
      done: "Выполнена",
      cancelled: "Отменена",
    },
    priorityLabels: {
      low: "Низкий",
      normal: "Обычный",
      high: "Высокий",
      urgent: "Срочный",
    },
  },
  ky: {
    title: "Admissions тапшырмалары",
    description: "Жооптуу, мөөнөт жана абал Supabase'тагы бир кейсте сакталат.",
    create: "Тапшырма түзүү",
    taskType: "Тапшырманын түрү",
    taskTitle: "Аталышы",
    assignee: "Жооптуу",
    priority: "Артыкчылык",
    dueAt: "Мөөнөт (UTC)",
    status: "Абал",
    studentVisible: "Студентке көрүнүшү",
    visible: "Көрүнөт",
    hidden: "Жашыруун",
    save: "Сактоо",
    saving: "Сакталууда…",
    edit: "Тапшырманы өзгөртүү",
    empty: "Азырынча тапшырма жок.",
    more: "Алгачкы 50 тапшырма көрсөтүлдү. Ишти тиешелүү Student 360 ичинде улантыңыз.",
    case: "Student 360",
    dueMissing: "Мөөнөт коюлган эмес",
    saved: "Өзгөртүүлөр сакталды.",
    invalid: "Тапшырманын маалыматтары четке кагылды. Талааларды текшериңиз.",
    unavailable: "Тапшырма өзгөргөн жок: Supabase операцияны ырастаган жок.",
    statusLabels: {
      open: "Ачык",
      in_progress: "Иште",
      blocked: "Тосулган",
      done: "Аткарылды",
      cancelled: "Жокко чыгарылды",
    },
    priorityLabels: {
      low: "Төмөн",
      normal: "Кадимки",
      high: "Жогору",
      urgent: "Шашылыш",
    },
  },
  en: {
    title: "Admissions tasks",
    description: "Ownership, due date and status live in the single Supabase case.",
    create: "Create task",
    taskType: "Task type",
    taskTitle: "Title",
    assignee: "Assignee",
    priority: "Priority",
    dueAt: "Due at (UTC)",
    status: "Status",
    studentVisible: "Student visibility",
    visible: "Visible",
    hidden: "Hidden",
    save: "Save",
    saving: "Saving…",
    edit: "Edit task",
    empty: "No tasks yet.",
    more: "The first 50 tasks are shown. Continue in the relevant Student 360.",
    case: "Student 360",
    dueMissing: "No due date",
    saved: "Changes saved.",
    invalid: "The task data was rejected. Check every field.",
    unavailable: "The task was not changed because Supabase did not confirm it.",
    statusLabels: {
      open: "Open",
      in_progress: "In progress",
      blocked: "Blocked",
      done: "Done",
      cancelled: "Cancelled",
    },
    priorityLabels: {
      low: "Low",
      normal: "Normal",
      high: "High",
      urgent: "Urgent",
    },
  },
} as const;

function isQueueTask(task: TaskView): task is PlatformAdmissionsTaskQueueRow {
  return "studentDisplayName" in task;
}

function dueInputValue(value: string | null): string {
  return value ? value.slice(0, 16) : "";
}

function formattedTimestamp(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function SubmitButton({ label, pendingLabel }: Readonly<{
  label: string;
  pendingLabel: string;
}>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnCls}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({
  feedback,
  copy,
}: Readonly<{
  feedback?: PlatformAdmissionsTaskFeedback;
  copy: (typeof COPY)[Locale];
}>) {
  if (!feedback) return null;
  const message = copy[feedback.outcome];
  return (
    <p
      className={cn(
        "border-y px-3 py-2 text-sm",
        feedback.outcome === "saved"
          ? "border-ok/30 bg-ok-weak text-ok"
          : feedback.outcome === "invalid"
            ? "border-warn/30 bg-warn-weak text-warn"
            : "border-danger/30 bg-danger-weak text-danger",
      )}
      role="status"
      data-testid="platform-admissions-task-feedback"
      data-outcome={feedback.outcome}
    >
      {message}
    </p>
  );
}

function CreateTaskForm({
  studentCaseId,
  requestId,
  assignees,
  actorMembershipId,
  presentationRole,
  copy,
}: Readonly<{
  studentCaseId: string;
  requestId: string;
  assignees: readonly PlatformAdmissionsTaskAssignee[];
  actorMembershipId: string;
  presentationRole: FixedRole;
  copy: (typeof COPY)[Locale];
}>) {
  const availableAssignees = presentationRole === "admin"
    ? assignees
    : assignees.filter((assignee) => assignee.membershipId === actorMembershipId);
  if (availableAssignees.length === 0) return null;

  return (
    <details className="border-y border-border bg-surface-2 px-4 py-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-fg">
        {copy.create}
      </summary>
      <form
        action={createPlatformAdmissionsTaskAction}
        className="grid gap-3 pb-2 pt-4 md:grid-cols-2"
        data-testid="platform-admissions-task-create-form"
      >
        <input type="hidden" name="student_case_id" value={studentCaseId} />
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="return_to_case" value="1" />
        <label>
          <span className={labelCls}>{copy.taskType}</span>
          <input name="task_type" required maxLength={200} defaultValue="follow_up" className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>{copy.taskTitle}</span>
          <input name="title" required maxLength={1_000} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>{copy.assignee}</span>
          <select name="assignee_membership_id" required className={inputCls} defaultValue={availableAssignees[0]?.membershipId}>
            {availableAssignees.map((assignee) => (
              <option key={assignee.membershipId} value={assignee.membershipId}>
                {assignee.displayName} · {assignee.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>{copy.priority}</span>
          <select name="priority" defaultValue="normal" className={inputCls}>
            {PLATFORM_CASE_TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>{copy.priorityLabels[priority]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>{copy.dueAt}</span>
          <input name="due_at" type="datetime-local" className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>{copy.status}</span>
          <select name="status" defaultValue="open" className={inputCls}>
            {PLATFORM_CASE_TASK_STATUSES.map((status) => (
              <option key={status} value={status}>{copy.statusLabels[status]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>{copy.studentVisible}</span>
          <select name="student_visible" defaultValue="false" className={inputCls}>
            <option value="false">{copy.hidden}</option>
            <option value="true">{copy.visible}</option>
          </select>
        </label>
        <div className="flex items-end">
          <SubmitButton label={copy.create} pendingLabel={copy.saving} />
        </div>
      </form>
    </details>
  );
}

function TaskChangeForm({
  task,
  requestId,
  assignees,
  presentationRole,
  copy,
  returnToCase,
}: Readonly<{
  task: TaskView;
  requestId: string;
  assignees: readonly PlatformAdmissionsTaskAssignee[];
  presentationRole: FixedRole;
  copy: (typeof COPY)[Locale];
  returnToCase: boolean;
}>) {
  const adminView = presentationRole === "admin";
  const hasAssigneeOptions = adminView && assignees.length > 0;
  return (
    <details className="mt-3">
      <summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold text-accent">
        {copy.edit}
      </summary>
      <form
        action={changePlatformAdmissionsTaskAction}
        className="grid gap-3 border-t border-border pt-4 md:grid-cols-2"
        data-testid="platform-admissions-task-change-form"
        data-task-id={task.caseTaskId}
      >
        <input type="hidden" name="student_case_id" value={task.studentCaseId} />
        <input type="hidden" name="case_task_id" value={task.caseTaskId} />
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="return_to_case" value={returnToCase ? "1" : "0"} />
        <label>
          <span className={labelCls}>{copy.status}</span>
          <select name="status" defaultValue={task.status} className={inputCls}>
            {PLATFORM_CASE_TASK_STATUSES.map((status) => (
              <option key={status} value={status}>{copy.statusLabels[status]}</option>
            ))}
          </select>
        </label>
        {hasAssigneeOptions ? (
          <label>
            <span className={labelCls}>{copy.assignee}</span>
            <select name="assignee_membership_id" defaultValue={task.assigneeMembershipId} className={inputCls}>
              {assignees.map((assignee) => (
                <option key={assignee.membershipId} value={assignee.membershipId}>
                  {assignee.displayName} · {assignee.role}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="assignee_membership_id" value={task.assigneeMembershipId} />
        )}
        {adminView ? (
          <>
            <label>
              <span className={labelCls}>{copy.priority}</span>
              <select name="priority" defaultValue={task.priority} className={inputCls}>
                {PLATFORM_CASE_TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>{copy.priorityLabels[priority]}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>{copy.dueAt}</span>
              <input name="due_at" type="datetime-local" defaultValue={dueInputValue(task.dueAt)} className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>{copy.studentVisible}</span>
              <select name="student_visible" defaultValue={String(task.studentVisible)} className={inputCls}>
                <option value="false">{copy.hidden}</option>
                <option value="true">{copy.visible}</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <input type="hidden" name="priority" value={task.priority} />
            <input type="hidden" name="due_at" value={task.dueAt ?? ""} />
            <input type="hidden" name="student_visible" value={String(task.studentVisible)} />
          </>
        )}
        <div className="flex items-end">
          <SubmitButton label={copy.save} pendingLabel={copy.saving} />
        </div>
      </form>
    </details>
  );
}

export function PlatformAdmissionsTaskPanel({
  locale,
  tasks,
  assignees = [],
  actorMembershipId,
  authorityRole,
  presentationRole,
  requestIds,
  createForCase,
  caseState,
  showCase = false,
  hasNext = false,
  feedback,
}: Readonly<{
  locale: Locale;
  tasks: readonly TaskView[];
  assignees?: readonly PlatformAdmissionsTaskAssignee[];
  actorMembershipId: string;
  authorityRole: FixedRole;
  presentationRole: FixedRole;
  requestIds: PlatformAdmissionsTaskRequestIds;
  createForCase?: Readonly<{ studentCaseId: string }>;
  caseState?: "active" | "closed";
  showCase?: boolean;
  hasNext?: boolean;
  feedback?: PlatformAdmissionsTaskFeedback;
}>) {
  const copy = COPY[locale];
  const canCreate = Boolean(
    createForCase &&
    caseState === "active" &&
    (presentationRole === "admin" || presentationRole === "admissions"),
  );

  return (
    <section
      className="space-y-4"
      data-testid="platform-admissions-task-panel"
      data-authority-role={authorityRole}
      data-presentation-role={presentationRole}
    >
      <header className="border-b border-border pb-4">
        <h2 className="text-lg font-semibold text-fg">{copy.title}</h2>
        <p className="mt-1 max-w-[56ch] text-sm text-fg-3">{copy.description}</p>
      </header>
      <Feedback feedback={feedback} copy={copy} />
      {canCreate && createForCase ? (
        <CreateTaskForm
          studentCaseId={createForCase.studentCaseId}
          requestId={requestIds.create}
          assignees={assignees}
          actorMembershipId={actorMembershipId}
          presentationRole={presentationRole}
          copy={copy}
        />
      ) : null}
      {tasks.length === 0 ? (
        <p className="border-y border-border py-7 text-sm text-fg-3">{copy.empty}</p>
      ) : (
        <ol className="divide-y divide-border border-y border-border" data-testid="platform-admissions-task-list">
          {tasks.map((task) => {
            const taskCaseState = isQueueTask(task) ? task.caseState : caseState;
            const canChange = taskCaseState === "active" && (
              presentationRole === "admin" ||
              (presentationRole === "admissions" && task.assigneeMembershipId === actorMembershipId)
            );
            return (
              <li
                key={task.caseTaskId}
                className="py-4"
                data-testid="platform-admissions-task"
                data-task-id={task.caseTaskId}
                data-status={task.status}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-fg">{task.title}</h3>
                      <Badge value={task.status} label={copy.statusLabels[task.status]} />
                      <span className="text-xs font-medium text-fg-3">{copy.priorityLabels[task.priority]}</span>
                    </div>
                    {isQueueTask(task) ? (
                      <p className="mt-1 text-sm text-fg-2">{task.studentDisplayName}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-fg-3">
                      {task.assigneeDisplayName} · {task.dueAt ? formattedTimestamp(task.dueAt, locale) : copy.dueMissing}
                    </p>
                    <p className="mt-1 text-xs text-fg-3">
                      {task.taskType} · {task.studentVisible ? copy.visible : copy.hidden}
                    </p>
                  </div>
                  {showCase ? (
                    <Link
                      href={`/clients/${task.studentCaseId}#case-tasks`}
                      className={cn(
                        btnGhostCls,
                        "inline-flex min-h-11 items-center",
                      )}
                    >
                      {copy.case}
                    </Link>
                  ) : null}
                </div>
                {canChange && requestIds.changes[task.caseTaskId] ? (
                  <TaskChangeForm
                    task={task}
                    requestId={requestIds.changes[task.caseTaskId]}
                    assignees={assignees}
                    presentationRole={presentationRole}
                    copy={copy}
                    returnToCase={!showCase}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {hasNext ? <p className="text-xs text-warn">{copy.more}</p> : null}
    </section>
  );
}
