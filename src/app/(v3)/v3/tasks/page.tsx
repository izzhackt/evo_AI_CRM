import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";
import { TaskComposerDialog } from "@/components/v3/tasks/TaskComposerDialog";
import { TaskDetailPanel } from "@/components/v3/tasks/TaskDetailPanel";
import { dayFullLabel, timeLabel } from "@/components/v3/calendar/types";
import { requireV3PageActor } from "@/lib/platform-guards";
import { parsePlatformAdmissionsTaskQueueCursor } from "@/lib/platform-admissions-workspace";
import { STAFF_TASK_FILTERS, STAFF_TASK_VIEWS, staffTaskTimestamp, staffTaskUuid } from "@/lib/platform-staff-task-contract";
import { dayInOrganizationTimezone, projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import { readStaffTaskWorkspace, type WorkspaceTask } from "@/lib/v3/staff-task-source";
import { readCalendarTaskTarget } from "@/lib/v3/calendar-source";
import { taskStatus } from "@/lib/v3/wording";
import { isTeamChatChannel, staffCanAccessChatChannel, type TeamChatMessage } from "@/lib/platform-team-chat";
import { readTeamChatPage, TeamChatReadError } from "@/lib/server/platform-team-chat-repository";
import { readStaffTaskChatSource, readStaffTaskContext, readStaffTaskLeadContext, readLeadTaskLinks, type StaffTaskContext } from "@/lib/server/platform-staff-task-repository";

export const dynamic = "force-dynamic";
export const metadata = { title: "Задачи" };
// Один вид «выбрано» для типа, владельца и состояния задач (см. `.v3-choice` в v3.css).
const CHOICE = "v3-choice inline-flex min-h-11 items-center rounded-ctl px-3 text-sm text-fg-2 hover:bg-surface-2";
type Params = Record<string, string | string[] | undefined>;
function single(params: Params, key: string) { const value = params[key]; if (Array.isArray(value)) notFound(); return value; }
function optionalUuid(params: Params, key: string) { const value = single(params, key); if (value === undefined) return null; return staffTaskUuid(value) ?? notFound(); }
function Deadline({ dueOn, dueAt, status, now }: { dueOn: string | null; dueAt: string | null; status: string; now: Date }) {
  const deadline = projectPlatformTaskDeadline(dueOn, dueAt, now);
  const overdue = deadline.overdue && status !== "done" && status !== "cancelled";
  return <span className={overdue ? "text-danger" : "text-fg-2"}>{deadline.day ? `${dayFullLabel(deadline.day)}${deadline.minutes === null ? " · весь день" : ` · ${timeLabel(deadline.minutes)}`}` : "Без срока"}{overdue ? " · Просрочено" : ""}</span>;
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [params, actor] = await Promise.all([searchParams, requireV3PageActor("/v3/tasks")]);
  const canUseStaffTasks = staffHasPermission(actor, "staff.task.read") || staffHasPermission(actor, "staff.task.create");
  const domain = single(params, "type") === "case" || !canUseStaffTasks ? "case" : "staff";
  const view = STAFF_TASK_VIEWS.find((value) => value === single(params, "view")) ?? "mine";
  const status = STAFF_TASK_FILTERS.find((value) => value === single(params, "status")) ?? "active";
  const taskId = optionalUuid(params, "task");
  const taskKind = single(params, "kind") === "case" ? "case" : "staff";
  const selectedCaseId = optionalUuid(params, "case");
  const sourceMessageId = optionalUuid(params, "message");
  const sourceLeadId = optionalUuid(params, "lead");
  const sourceChannel = single(params, "channel");
  const openIntent = optionalUuid(params, "open");
  if (taskId && taskKind === "case" && !selectedCaseId) notFound();
  if (sourceMessageId && (!isTeamChatChannel(sourceChannel) || taskId || selectedCaseId
    || sourceLeadId || domain !== "staff" || single(params, "create") !== "staff")) notFound();
  if (sourceLeadId && (taskId || selectedCaseId || domain !== "staff")) notFound();
  let sourceLead: Awaited<ReturnType<typeof readStaffTaskLeadContext>> | null = null;
  let leadTasks: Awaited<ReturnType<typeof readLeadTaskLinks>> | null = null;
  if (sourceLeadId) {
    try {
      [sourceLead, leadTasks] = await Promise.all([readStaffTaskLeadContext(actor, sourceLeadId), readLeadTaskLinks(actor, sourceLeadId)]);
    } catch {
      return <PartShell title="Задачи"><p role="alert" className="text-sm text-danger">Не удалось проверить доступ к лиду и связанным задачам. Обновите страницу.</p></PartShell>;
    }
    if (!sourceLead) notFound();
  }
  let sourceMessage: TeamChatMessage | undefined;
  if (sourceMessageId && isTeamChatChannel(sourceChannel)) {
    if (!staffCanAccessChatChannel(actor, sourceChannel)) notFound();
    try {
      const page = await readTeamChatPage(actor, { channel: sourceChannel, mode: "message", messageId: sourceMessageId });
      sourceMessage = page.messages.find((message) => message.id === sourceMessageId && !message.deletedAt);
    } catch (error) {
      if (error instanceof TeamChatReadError && ["forbidden", "not_found"].includes(error.status)) notFound();
      return <PartShell title="Задачи"><p role="alert" className="text-sm text-danger">Не удалось проверить исходное сообщение. Обновите страницу; задача не создана.</p></PartShell>;
    }
    if (!sourceMessage) notFound();
  }
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
  try { workspace = await readStaffTaskWorkspace(actor, { view, status, cursor, caseCursor, domain, taskId: taskKind === "staff" ? taskId : null, selectedCaseId }); }
  catch { return <PartShell title="Задачи"><p role="alert" className="text-sm text-danger">Не удалось загрузить задачи и доступных сотрудников. Обновите страницу.</p></PartShell>; }
  if (taskId && taskKind === "staff" && !workspace.selectedTask) notFound();
  if (selectedCaseId && !taskId && !workspace.selectedCase) notFound();
  let caseTaskTarget: Awaited<ReturnType<typeof readCalendarTaskTarget>> | null = null;
  if (taskId && taskKind === "case" && selectedCaseId) {
    try { caseTaskTarget = await readCalendarTaskTarget(actor, selectedCaseId, taskId); }
    catch { notFound(); }
  }
  const selected = workspace.selectedTask;
  let taskContext: StaffTaskContext | null = null;
  let contextUnavailable = false;
  if (selected) {
    try { taskContext = await readStaffTaskContext(actor, selected.id); }
    catch { contextUnavailable = true; }
  }
  let selectedSourceHref: string | null = null;
  let sourceUnavailable = false;
  if (selected?.sourceMessageId) {
    try { selectedSourceHref = await readStaffTaskChatSource(actor, selected.id); }
    catch { sourceUnavailable = true; }
  }
  const href = (overrides: Record<string, string>) => `/v3/tasks?${new URLSearchParams({ type: domain, view, status, ...overrides })}`;
  const listParams: Record<string, string> = { type: domain, view, status };
  if (cursor) { listParams.before_at = cursor.updatedAt; listParams.before_id = cursor.id; }
  if (caseCursor) { listParams.case_after_at = caseCursor.sortAt; listParams.case_after_id = caseCursor.caseTaskId; }
  const closeHref = `/v3/tasks?${new URLSearchParams(listParams)}`;
  function taskHref(item: WorkspaceTask): string {
    const query = new URLSearchParams(listParams);
    if (item.kind === "staff") { query.set("task", item.task.id); return `/v3/tasks?${query}`; }
    query.set("task", item.task.caseTaskId); query.set("kind", "case"); query.set("case", item.task.studentCaseId);
    return `/v3/tasks?${query}`;
  }
  const nextHref = domain === "staff" && workspace.nextCursor ? href({ before_at: workspace.nextCursor.updatedAt, before_id: workspace.nextCursor.id })
    : domain === "case" && workspace.caseNextCursor ? href({ case_after_at: workspace.caseNextCursor.sortAt, case_after_id: workspace.caseNextCursor.caseTaskId }) : null;
  const canReadTaskQueue = domain === "staff" ? workspace.canReadStaffTasks : workspace.canReadCaseTasks;
  const composer = <TaskComposerDialog key={sourceMessage?.id ?? sourceLead?.leadId ?? "standalone"}
    participants={workspace.assignees} actorMembershipId={actor.membershipId} actor={actor} day={day}
    staffAllowed={!isStaffPreview(actor) && staffHasPermission(actor, "staff.task.create") && !sourceLeadId}
    caseAllowed={!isStaffPreview(actor) && workspace.canReadCases && staffHasPermission(actor, "task.create")}
    initialCase={workspace.selectedCase ? { id: workspace.selectedCase.id, name: workspace.selectedCase.name } : null}
    initialCaseAssignees={workspace.caseAssignees}
    sourceMessageId={sourceMessage?.id} sourceMessageVersion={sourceMessage?.version}
    sourceLeadId={sourceLead?.leadId} sourceLeadVersion={sourceLead?.workflowVersion}
    openIntent={openIntent ?? single(params, "create") ?? null}
  />;
  return <>
    <PartShell title="Задачи" action={!sourceLead ? composer : undefined}>
    {sourceLead ? <section className="mb-5 space-y-3 border-y border-border py-4" aria-label="Задачи по лиду">
      <h2 className="t-section">{sourceLead.clientDisplayName ?? "Имя клиента не указано"}</h2>
      <p className="text-sm text-fg-2">Следующее действие воронки: {sourceLead.nextActionText ?? "Не назначено"}{sourceLead.nextActionDueDate ? ` · ${sourceLead.nextActionDueDate}` : ""}</p>
      {sourceLead.canOpenPipeline ? <Link href={sourceLead.clientDisplayName === "Имя клиента не указано" ? "/v3/pipeline" : `/v3/pipeline?q=${encodeURIComponent(sourceLead.clientDisplayName)}`} className="inline-flex min-h-11 items-center text-sm underline">Открыть в воронке</Link> : null}
      {composer}
      <h3 className="t-item">Связанные рабочие задачи</h3>
      {leadTasks?.rows.length ? <ul className="divide-y divide-border">{leadTasks.rows.map((task) => <li key={task.id}><Link href={`/v3/tasks?task=${task.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm"><span className="break-words underline">{task.title}</span><Badge value={task.status} label={taskStatus(task.status) ?? task.status} /></Link></li>)}</ul> : <EmptyState text="Нет доступных связанных задач. Можно создать первую выше." />}
      {leadTasks?.truncated ? <p className="text-sm text-fg-2">Показаны последние 50 задач. Остальные доступны в общем списке.</p> : null}
      <Link href="/v3/tasks" className="inline-flex min-h-11 items-center text-sm underline">Все мои задачи →</Link>
    </section> : <>
    {sourceMessage ? <section className="mb-4 rounded-card border border-border bg-surface p-4" aria-label="Исходное сообщение">
      <p className="text-sm font-semibold">Задача из сообщения · {sourceMessage.authorName}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{sourceMessage.body}</p>
      <p className="mt-2 text-sm text-fg-3">Проверьте название и исполнителя перед сохранением. Доступ к закрытому каналу не расширяется.</p>
      <Link href={`/v3/team-chat?channel=${sourceMessage.channelKey}&message=${sourceMessage.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm underline">Вернуться к сообщению</Link>
    </section> : null}
    {workspace.canReadStaffTasks || workspace.canReadCaseTasks ? <nav aria-label="Тип задач" className="mb-4 flex flex-wrap gap-2 border-b border-border pb-2">
      {workspace.canReadStaffTasks ? <Link href={href({ type: "staff" })} aria-current={domain === "staff" ? "page" : undefined} className={CHOICE}>Рабочие</Link> : null}
      {workspace.canReadCaseTasks ? <Link href={href({ type: "case" })} aria-current={domain === "case" ? "page" : undefined} className={CHOICE}>По студентам</Link> : null}
    </nav> : null}
    {!canReadTaskQueue ? <p role="status" className="border-y border-border py-8 text-sm text-fg-2">
      {domain === "case" ? "В вашей роли нет права на просмотр задач по студентам." : "В вашей роли нет права на просмотр рабочих задач."}
      {!isStaffPreview(actor) && (domain === "case" ? workspace.canReadCases && staffHasPermission(actor, "task.create") : staffHasPermission(actor, "staff.task.create")) ? " Создание задачи доступно выше." : null}
    </p> : <>
    {domain === "staff" ? <div className="mb-4 flex flex-wrap justify-between gap-2">
      <nav aria-label="Чьи задачи" className="flex flex-wrap gap-2">{([["mine", "Мои"], ["created", "Назначенные мной"], ["all", "Все доступные"]] as const).map(([value, label]) =>
        <Link key={value} href={href({ view: value })} aria-current={view === value ? "page" : undefined} className={CHOICE}>{label}</Link>)}</nav>
      <nav aria-label="Состояние задач" className="flex flex-wrap gap-2">{([["active", "В работе"], ["overdue", "Просрочено"], ["completed", "Завершённые"], ["all", "Все статусы"]] as const).map(([value, label]) =>
        <Link key={value} href={href({ status: value })} aria-current={status === value ? "page" : undefined} className={CHOICE}>{label}</Link>)}</nav>
    </div> : <p className="mb-4 text-sm text-fg-2">Доступные задачи по студентам.</p>}
    <p className="mb-2 text-sm text-fg-2">Сроки указаны по времени Бишкека.</p>
    {workspace.tasks.length === 0 ? <div role="status"><EmptyState text={cursor || caseCursor ? "В этой части списка задач нет." : "Задач по выбранному фильтру пока нет."} /></div> : <Card bodyClassName="p-0">
      <ul className="divide-y divide-border">
      {workspace.tasks.map((item) => <li key={`${item.kind}:${item.kind === "staff" ? item.task.id : item.task.caseTaskId}`}>
        <Link href={taskHref(item)} scroll={false} className="flex min-h-11 flex-col gap-3 px-4 py-4 hover:bg-surface-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.task.title}</p>
            <p className="mt-1 break-words text-sm text-fg-2">{item.kind === "case" ? `По студенту · ${item.task.studentDisplayName}` : "Рабочая задача"} · {item.task.assigneeDisplayName}</p></div>
          <div className="flex shrink-0 flex-col items-start gap-1.5 text-sm sm:items-end">
            <Badge value={item.task.status} label={taskStatus(item.task.status) ?? item.task.status} />
            <Deadline dueOn={item.task.dueOn} dueAt={item.task.dueAt} status={item.task.status} now={now} />
          </div>
        </Link>
      </li>)}
      </ul>
    </Card>}
    <nav aria-label="Страницы задач" className="mt-4 flex flex-wrap gap-4">
      {cursor || caseCursor ? <Link href={href({})} className="inline-flex min-h-11 items-center text-sm underline">К началу списка</Link> : null}
      {nextHref ? <Link href={nextHref} className="inline-flex min-h-11 items-center text-sm text-accent-text underline">Следующие задачи →</Link> : null}
    </nav>
    </>}
    </>}
    </PartShell>
    {selected ? <TaskDetailPanel day={day} closeHref={closeHref} data={{
      kind: "staff", task: selected, participants: workspace.assignees,
      extra: {
        leadHref: taskContext?.leadId ? `/v3/tasks?lead=${taskContext.leadId}` : null,
        sourceHref: selectedSourceHref, sourceUnavailable: Boolean(selected.sourceMessageId) && !selectedSourceHref && sourceUnavailable,
        outcomes: taskContext?.outcomes ?? [], outcomesUnavailable: contextUnavailable,
      },
    }} /> : null}
    {caseTaskTarget ? <TaskDetailPanel day={day} closeHref={closeHref} data={{
      kind: "case", task: caseTaskTarget.task, caseId: selectedCaseId!,
      assignees: caseTaskTarget.assignees, capabilities: caseTaskTarget.capabilities,
    }} /> : null}
  </>;
}
