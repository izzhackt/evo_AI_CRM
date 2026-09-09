import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { StaffTaskForm, StaffTaskStatusForm } from "@/components/v3/tasks/StaffTaskForm";
import { TaskComposer } from "@/components/v3/tasks/TaskComposer";
import { dayFullLabel, timeLabel } from "@/components/v3/calendar/types";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { parsePlatformAdmissionsTaskQueueCursor } from "@/lib/platform-admissions-workspace";
import { STAFF_TASK_FILTERS, STAFF_TASK_VIEWS, staffTaskTimestamp, staffTaskUuid } from "@/lib/platform-staff-task-contract";
import { dayInOrganizationTimezone, projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import { readStaffTaskWorkspace, type WorkspaceTask } from "@/lib/v3/staff-task-source";
import { taskStatus } from "@/lib/v3/wording";

export const dynamic = "force-dynamic";
type Params = Record<string, string | string[] | undefined>;
function single(params: Params, key: string) { const value = params[key]; if (Array.isArray(value)) notFound(); return value; }
function optionalUuid(params: Params, key: string) { const value = single(params, key); if (value === undefined) return null; return staffTaskUuid(value) ?? notFound(); }
function taskHref(item: WorkspaceTask) {
  return item.kind === "staff" ? `/v3/tasks?task=${item.task.id}` : `/v3/calendar?case=${item.task.studentCaseId}&task=${item.task.caseTaskId}`;
}
function Deadline({ dueOn, dueAt, status, now }: { dueOn: string | null; dueAt: string | null; status: string; now: Date }) {
  const deadline = projectPlatformTaskDeadline(dueOn, dueAt, now);
  const overdue = deadline.overdue && status !== "done" && status !== "cancelled";
  return <span className={overdue ? "text-danger" : "text-fg-2"}>{deadline.day ? `${dayFullLabel(deadline.day)}${deadline.minutes === null ? " · весь день" : ` · ${timeLabel(deadline.minutes)}`}` : "Без срока"}{overdue ? " · Просрочено" : ""}</span>;
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [params, actor] = await Promise.all([searchParams, requirePlatformStaffActor()]);
  if (!["admin", "sales", "admissions"].includes(actor.authorityRole) || !["admin", "sales", "admissions"].includes(actor.presentationRole)) redirect("/access-denied?from=%2Fv3%2Ftasks");
  const domain = single(params, "type") === "case" ? "case" : "staff";
  const view = STAFF_TASK_VIEWS.find((value) => value === single(params, "view")) ?? "mine";
  const status = STAFF_TASK_FILTERS.find((value) => value === single(params, "status")) ?? "active";
  const taskId = optionalUuid(params, "task");
  const selectedCaseId = optionalUuid(params, "case");
  const beforeAt = single(params, "before_at");
  const beforeId = single(params, "before_id");
  const cursor = beforeAt === undefined && beforeId === undefined ? null : {
    updatedAt: staffTaskTimestamp(beforeAt) ?? notFound(), id: staffTaskUuid(beforeId) ?? notFound(),
  };
  const caseAt = single(params, "case_after_at");
  const caseId = single(params, "case_after_id");
  const caseCursor = caseAt === undefined && caseId === undefined ? null : parsePlatformAdmissionsTaskQueueCursor(caseAt, caseId) ?? notFound();
  const now = new Date();
  const day = dayInOrganizationTimezone(now);
  let workspace;
  try { workspace = await readStaffTaskWorkspace(actor, { view, status, cursor, caseCursor, domain, taskId, selectedCaseId }); }
  catch { return <PartShell title="Задачи"><p role="alert" className="text-sm text-danger">Не удалось загрузить задачи и доступных сотрудников. Обновите страницу.</p></PartShell>; }
  if (taskId && !workspace.selectedTask) notFound();
  if (selectedCaseId && !workspace.selectedCase) notFound();
  const selected = workspace.selectedTask;
  const href = (overrides: Record<string, string>) => `/v3/tasks?${new URLSearchParams({ type: domain, view, status, ...overrides })}`;
  if (selected) return <PartShell title="Рабочая задача" width="narrow">
    <Link href="/v3/tasks" className="inline-flex min-h-11 items-center text-sm text-fg-2 underline">← К задачам</Link>
    <section className="space-y-5 border-t border-border py-5">
      <h2 className="break-words text-xl font-semibold">{selected.title}</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-fg-2">Исполнитель</dt><dd>{selected.assigneeDisplayName}</dd></div>
        <div><dt className="text-fg-2">Создатель</dt><dd>{selected.creatorDisplayName}</dd></div>
        <div><dt className="text-fg-2">Срок · Бишкек</dt><dd><Deadline dueOn={selected.dueOn} dueAt={selected.dueAt} status={selected.status} now={now} /></dd></div>
      </dl>
      {selected.description ? <p className="whitespace-pre-wrap break-words text-sm leading-6">{selected.description}</p> : null}
      <StaffTaskStatusForm key={`status:${selected.id}:${selected.version}`} task={selected} requestId={randomUUID()} />
    </section>
    {actor.authorityRole === "admin" || selected.creatorMembershipId === actor.membershipId ? <details className="border-t border-border py-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Изменить содержание и назначение</summary>
      <StaffTaskForm key={`edit:${selected.id}:${selected.version}`} task={selected} participants={workspace.assignees} actorMembershipId={actor.membershipId} day={day} requestId={randomUUID()} />
    </details> : null}
  </PartShell>;
  const nextHref = domain === "staff" && workspace.nextCursor ? href({ before_at: workspace.nextCursor.updatedAt, before_id: workspace.nextCursor.id })
    : domain === "case" && workspace.caseNextCursor ? href({ case_after_at: workspace.caseNextCursor.sortAt, case_after_id: workspace.caseNextCursor.caseTaskId }) : null;
  return <PartShell title="Задачи">
    <TaskComposer participants={workspace.assignees} actorMembershipId={actor.membershipId} presentationRole={actor.presentationRole}
      canCreateCase={workspace.canReadCases} selectedCase={workspace.selectedCase} day={day} requestId={randomUUID()} caseRequestId={randomUUID()}
      initiallyOpen={single(params, "create") !== undefined} initialKind={single(params, "create") === "case" ? "case" : "staff"} />
    <nav aria-label="Тип задач" className="mb-4 flex flex-wrap gap-2 border-b border-border">
      <Link href={href({ type: "staff" })} aria-current={domain === "staff" ? "page" : undefined} className={`min-h-11 px-3 py-3 text-sm ${domain === "staff" ? "border-b-2 border-accent font-semibold" : "text-fg-2"}`}>Рабочие</Link>
      {workspace.canReadCases ? <Link href={href({ type: "case" })} aria-current={domain === "case" ? "page" : undefined} className={`min-h-11 px-3 py-3 text-sm ${domain === "case" ? "border-b-2 border-accent font-semibold" : "text-fg-2"}`}>По студентам</Link> : null}
    </nav>
    {domain === "staff" ? <div className="mb-4 flex flex-wrap justify-between gap-2">
      <nav aria-label="Чьи задачи" className="flex flex-wrap gap-2">{([["mine", "Мои"], ["created", "Назначенные мной"], ["all", "Все доступные"]] as const).map(([value, label]) =>
        <Link key={value} href={href({ view: value })} aria-current={view === value ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-ctl px-3 text-sm ${view === value ? "bg-surface-2 font-semibold" : "text-fg-2"}`}>{label}</Link>)}</nav>
      <nav aria-label="Состояние задач" className="flex flex-wrap gap-2">{([["active", "В работе"], ["overdue", "Просрочено"], ["completed", "Завершённые"], ["all", "Все статусы"]] as const).map(([value, label]) =>
        <Link key={value} href={href({ status: value })} aria-current={status === value ? "page" : undefined} className={`inline-flex min-h-11 items-center px-2 text-sm ${status === value ? "font-semibold text-accent-text" : "text-fg-2"}`}>{label}</Link>)}</nav>
    </div> : <p className="mb-4 text-sm text-fg-2">Доступные задачи по студентам. Изменения открываются в календаре.</p>}
    <p className="mb-2 text-sm text-fg-2">Сроки указаны по времени Бишкека.</p>
    {workspace.tasks.length === 0 ? <p role="status" className="border-y border-border py-8 text-sm text-fg-2">{cursor || caseCursor ? "В этой части списка задач нет." : "Задач по выбранному фильтру пока нет."}</p> : <ul className="divide-y divide-border border-y border-border">
      {workspace.tasks.map((item) => <li key={`${item.kind}:${item.kind === "staff" ? item.task.id : item.task.caseTaskId}`}>
        <Link href={taskHref(item)} className="flex min-h-11 flex-col gap-3 px-1 py-4 hover:bg-surface-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.task.title}</p>
            <p className="mt-1 break-words text-sm text-fg-2">{item.kind === "case" ? `По студенту · ${item.task.studentDisplayName}` : "Рабочая задача"} · {item.task.assigneeDisplayName}</p></div>
          <div className="shrink-0 text-sm sm:text-right"><p>{taskStatus(item.task.status)}</p><p className="mt-1"><Deadline dueOn={item.task.dueOn} dueAt={item.task.dueAt} status={item.task.status} now={now} /></p></div>
        </Link>
      </li>)}
    </ul>}
    <nav aria-label="Страницы задач" className="mt-4 flex flex-wrap gap-4">
      {cursor || caseCursor ? <Link href={href({})} className="inline-flex min-h-11 items-center text-sm underline">К началу списка</Link> : null}
      {nextHref ? <Link href={nextHref} className="inline-flex min-h-11 items-center text-sm text-accent-text underline">Следующие задачи →</Link> : null}
    </nav>
  </PartShell>;
}
