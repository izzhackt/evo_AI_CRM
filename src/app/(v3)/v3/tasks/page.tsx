import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";
import { QueueError } from "@/components/v3/queue/QueueStates";
import { queueHref } from "@/components/v3/queue/queue-url";
import { TaskComposerDialog } from "@/components/v3/tasks/TaskComposerDialog";
import { TaskDetailPanel } from "@/components/v3/tasks/TaskDetailPanel";
import { TasksWorkspace } from "@/components/v3/tasks/TasksWorkspace";
import { TasksNextFailureLazy, TasksNextLazy } from "@/components/v3/tasks/next/TasksNextLazy";
import { caseSheetData, staffSheetData } from "@/components/v3/tasks/next/task-sheet-data";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isNextUi } from "@/lib/ui-next";
import { staffTaskUuid } from "@/lib/platform-staff-task-contract";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { readStaffTaskWorkspace, taskQueueAccess } from "@/lib/v3/staff-task-source";
import { buildTaskQueue, parseTaskQueueFilters, taskQueueParams } from "@/lib/v3/task-queue";
import { readCalendarTaskTarget } from "@/lib/v3/calendar-source";
import { callerDisplayName, taskStatus } from "@/lib/v3/wording";
import { isTeamChatChannel, staffCanAccessChatChannel, type TeamChatMessage } from "@/lib/platform-team-chat";
import { readTeamChatPage, TeamChatReadError } from "@/lib/server/platform-team-chat-repository";
import { readStaffTaskChatSource, readStaffTaskContext, readStaffTaskLeadContext, readLeadTaskLinks, type StaffTaskContext } from "@/lib/server/platform-staff-task-repository";
import { readDialOptions } from "@/lib/v3/telephony-dial-source";
import { readLeadRef, readQueueTaskLeads, type TaskLeadRef } from "@/lib/v3/telephony-task-leads-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Задачи" };
type Params = Record<string, string | string[] | undefined>;
function single(params: Params, key: string) { const value = params[key]; if (Array.isArray(value)) notFound(); return value; }
function optionalUuid(params: Params, key: string) { const value = single(params, key); if (value === undefined) return null; return staffTaskUuid(value) ?? notFound(); }

export default async function TasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [params, actor] = await Promise.all([searchParams, requireV3PageActor("/v3/tasks")]);
  // «Новый вид» (27.10.2026): только настоящему администратору с переключателем; данные, права и действия те же.
  const nextUi = await isNextUi(actor);
  const failure = (text: string, retryHref: string) => nextUi
    ? <TasksNextFailureLazy text={text} retryHref={retryHref} />
    : <PartShell title="Задачи"><QueueError text={text} retryHref={retryHref} /></PartShell>;
  const access = taskQueueAccess(actor);
  const preview = isStaffPreview(actor);
  const canUseStaffTasks = staffHasPermission(actor, "staff.task.read") || staffHasPermission(actor, "staff.task.create");
  const filters = parseTaskQueueFilters((key) => single(params, key), { teamView: access.teamView });
  const taskId = optionalUuid(params, "task");
  const taskKind = single(params, "kind") === "case" ? "case" : "staff";
  const selectedCaseId = optionalUuid(params, "case");
  const sourceMessageId = optionalUuid(params, "message");
  const sourceLeadId = optionalUuid(params, "lead");
  const sourceChannel = single(params, "channel");
  const openIntent = optionalUuid(params, "open");
  const staffOnlySource = single(params, "type") === "case" || !canUseStaffTasks;
  if (taskId && taskKind === "case" && !selectedCaseId) notFound();
  if (sourceMessageId && (!isTeamChatChannel(sourceChannel) || taskId || selectedCaseId
    || sourceLeadId || staffOnlySource || single(params, "create") !== "staff")) notFound();
  if (sourceLeadId && (taskId || selectedCaseId || staffOnlySource)) notFound();
  let sourceLead: Awaited<ReturnType<typeof readStaffTaskLeadContext>> | null = null;
  let leadTasks: Awaited<ReturnType<typeof readLeadTaskLinks>> | null = null;
  if (sourceLeadId) {
    try {
      [sourceLead, leadTasks] = await Promise.all([readStaffTaskLeadContext(actor, sourceLeadId), readLeadTaskLinks(actor, sourceLeadId)]);
    } catch {
      return failure("Не удалось проверить доступ к лиду и связанным задачам.", `/v3/tasks?lead=${sourceLeadId}&create=staff`);
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
      return failure("Не удалось проверить исходное сообщение; задача не создана.", `/v3/tasks?${new URLSearchParams({ message: sourceMessageId, channel: sourceChannel, create: "staff" })}`);
    }
    if (!sourceMessage) notFound();
  }

  const now = new Date();
  const day = dayInOrganizationTimezone(now);
  const listParams = taskQueueParams(filters);
  const listHref = (overrides: Record<string, string | null> = {}) => queueHref("/v3/tasks", listParams, overrides);
  let workspace;
  try {
    workspace = await readStaffTaskWorkspace(actor, {
      view: filters.view, state: filters.state, type: filters.type, due: filters.due, today: day, window: filters.window,
      taskId: taskKind === "staff" ? taskId : null, selectedCaseId,
    });
  } catch {
    return failure("Не удалось загрузить задачи и доступных сотрудников.", listHref());
  }
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
  // Набор читается один раз: от него зависит, называют ли панель и список клиента (как на «Сегодня»).
  let dialRead: ReturnType<typeof readDialOptions> | null = null;
  const dialOptions = () => (dialRead ??= readDialOptions(actor));
  // Задача «Перезвонить клиенту» несёт лид: пока набор открыт этому сотруднику, панель называет клиента и звонит.
  let taskLead: (TaskLeadRef & { mapped: boolean }) | null = null;
  if (selected && taskContext?.leadId) {
    const dial = await dialOptions();
    if (dial.status === "ready") {
      const ref = await readLeadRef(actor, taskContext.leadId);
      if (ref) taskLead = { ...ref, mapped: dial.mapped };
    }
  }
  let selectedSourceHref: string | null = null;
  let sourceUnavailable = false;
  if (selected?.sourceMessageId) {
    try { selectedSourceHref = await readStaffTaskChatSource(actor, selected.id); }
    catch { sourceUnavailable = true; }
  }

  let queue;
  try {
    queue = buildTaskQueue({
      staff: workspace.queue.staff, cases: workspace.queue.cases, filters,
      actorMembershipId: actor.membershipId, now, complete: workspace.queue.complete,
    });
  } catch {
    // Повтор одной задачи в двух страницах чтения — данные не сходятся: не показываем их.
    return failure("Список задач прочитан с расхождением. Повторите загрузку.", listHref());
  }
  // Панель — часть адреса списка: закрытие возвращает те же вид, фильтры и поиск.
  const closeHref = listHref();
  const canReadTaskQueue = workspace.canReadStaffTasks || workspace.canReadCaseTasks;
  // Задачи-перезвоны называют клиента в строке — только пока набор открыт этому сотруднику, как на «Сегодня»
  // (иначе список называл бы клиентов там, где панель не называет); у страницы «Задачи по лиду» списка нет.
  // Чтение не удалось — строка остаётся без клиента.
  const taskLeads = !sourceLead && canReadTaskQueue && workspace.canReadStaffTasks && (await dialOptions()).status === "ready"
    ? await readQueueTaskLeads(actor, queue.bands.flatMap((band) => band.rows)) : {};
  // Тот же набор, что назвал клиентов: «Позвонить» в строках — только при `ready` и только у строк с клиентом.
  const listDial = Object.keys(taskLeads).length > 0 ? await dialOptions() : null;
  const staffAllowed = !preview && staffHasPermission(actor, "staff.task.create") && !sourceLeadId;
  const composerProps = {
    participants: workspace.assignees, actorMembershipId: actor.membershipId, actor, day, staffAllowed,
    caseAllowed: !isStaffPreview(actor) && workspace.canReadCases && staffHasPermission(actor, "task.create"),
    initialCase: workspace.selectedCase ? { id: workspace.selectedCase.id, name: workspace.selectedCase.name } : null,
    initialCaseAssignees: workspace.caseAssignees,
    sourceMessageId: sourceMessage?.id, sourceMessageVersion: sourceMessage?.version,
    sourceLeadId: sourceLead?.leadId, sourceLeadVersion: sourceLead?.workflowVersion,
  };
  const canCreate = !preview && (composerProps.staffAllowed || composerProps.caseAllowed);
  const selectedKey = caseTaskTarget ? `case:${caseTaskTarget.task.id}` : selected ? `staff:${selected.id}` : null;
  const moveOpen = single(params, "move") === "1";
  const permissions = {
    actorMembershipId: actor.membershipId, admin: actor.systemRole === "admin" && !preview, preview,
    staffComplete: staffHasPermission(actor, "staff.task.complete"), staffEdit: staffHasPermission(actor, "staff.task.edit"),
    caseManage: staffHasPermission(actor, "task.manage"), caseAssign: staffHasPermission(actor, "task.assign"),
  };
  const headerCount = canReadTaskQueue && queue.complete && !sourceLead && !workspace.canReadStaffTasks && !access.teamView ? queue.rows.length : null;
  if (nextUi) {
    const sheet = selected ? staffSheetData({
      task: selected, participants: workspace.assignees, day, nowIso: now.toISOString(), leadId: taskContext?.leadId ?? null, lead: taskLead,
      sourceHref: selectedSourceHref, sourceUnavailable, outcomes: contextUnavailable ? null : taskContext?.outcomes ?? [],
    }) : caseTaskTarget ? caseSheetData({
      task: caseTaskTarget.task, caseId: selectedCaseId!, assignees: caseTaskTarget.assignees, capabilities: caseTaskTarget.capabilities,
      day, nowIso: now.toISOString(),
    }) : null;
    return <TasksNextLazy
      filters={filters} queue={queue} cutOff={workspace.queue.cutOff} day={day} nowIso={now.toISOString()}
      canReadStaffTasks={workspace.canReadStaffTasks} canReadCaseTasks={workspace.canReadCaseTasks} teamView={access.teamView}
      createdExcludesCases={workspace.createdExcludesCases} composer={composerProps} composerKey={sourceMessage?.id ?? "standalone"}
      canCreate={canCreate} urlIntent={openIntent ?? single(params, "create") ?? null} permissions={permissions}
      taskLeads={taskLeads} dial={listDial} count={headerCount} sheet={sheet} closeHref={closeHref} moveOpen={moveOpen}
      sourceMessage={sourceMessage ? { id: sourceMessage.id, channelKey: sourceMessage.channelKey, authorName: sourceMessage.authorName, body: sourceMessage.body } : null}
      sourceLead={sourceLead} leadTasks={leadTasks}
    />;
  }
  // Своя панель на каждую задачу: введённое в одной не переезжает в другую.
  const panel = selected ? <TaskDetailPanel key={`staff:${selected.id}`} day={day} nowIso={now.toISOString()} closeHref={closeHref} moveOpen={moveOpen} readOnly={preview} data={{
    kind: "staff", task: selected, participants: workspace.assignees,
    extra: {
      leadHref: taskContext?.leadId ? `/v3/tasks?lead=${taskContext.leadId}` : null,
      lead: taskLead,
      sourceHref: selectedSourceHref, sourceUnavailable: Boolean(selected.sourceMessageId) && !selectedSourceHref && sourceUnavailable,
      outcomes: taskContext?.outcomes ?? [], outcomesUnavailable: contextUnavailable,
    },
  }} /> : caseTaskTarget ? <TaskDetailPanel key={`case:${caseTaskTarget.task.id}`} day={day} nowIso={now.toISOString()} closeHref={closeHref} moveOpen={moveOpen} readOnly={preview} data={{
    kind: "case", task: caseTaskTarget.task, caseId: selectedCaseId!,
    assignees: caseTaskTarget.assignees, capabilities: caseTaskTarget.capabilities,
  }} /> : null;

  return <>
    <PartShell title="Задачи" count={headerCount}>
    {sourceLead ? <section className="mb-5 space-y-3 border-y border-border py-4" aria-label="Задачи по лиду">
      <h2 className="t-section">{callerDisplayName(sourceLead.clientDisplayName ?? "Имя клиента не указано")}</h2>
      <p className="t-body-compact text-fg-2">Следующее действие воронки: {sourceLead.nextActionText ?? "Не назначено"}{sourceLead.nextActionDueDate ? ` · ${sourceLead.nextActionDueDate}` : ""}</p>
      {sourceLead.canOpenPipeline ? <Link href={sourceLead.clientDisplayName === "Имя клиента не указано" ? "/v3/pipeline" : `/v3/pipeline?q=${encodeURIComponent(sourceLead.clientDisplayName)}`} className="inline-flex min-h-11 items-center t-label underline">Открыть в воронке</Link> : null}
      <TaskComposerDialog key={sourceLead.leadId} {...composerProps}
        openIntent={openIntent ?? single(params, "create") ?? null} triggerLabel="Новая задача по лиду"
        triggerClassName="inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg" />
      <h3 className="t-item">Связанные рабочие задачи</h3>
      {leadTasks?.rows.length ? <ul className="divide-y divide-border">{leadTasks.rows.map((task) => <li key={task.id}><Link href={`/v3/tasks?task=${task.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 t-body-compact"><span className="break-words underline">{task.title}</span><Badge value={task.status} label={taskStatus(task.status) ?? task.status} /></Link></li>)}</ul> : <EmptyState text="Связанных задач нет." />}
      {leadTasks?.truncated ? <p className="t-body-compact text-fg-2">Показаны последние 50.</p> : null}
      <Link href="/v3/tasks" className="inline-flex min-h-11 items-center t-label underline">Все мои задачи</Link>
    </section> : <>
    {sourceMessage ? <section className="mb-4 space-y-2 border-y border-border py-4" aria-label="Исходное сообщение">
      <p className="t-item">Задача из сообщения · {sourceMessage.authorName}</p>
      <p className="whitespace-pre-wrap break-words t-body-compact">{sourceMessage.body}</p>
      <p className="t-body-compact text-fg-3">Проверьте название и исполнителя. Доступ к каналу не меняется.</p>
      <Link href={`/v3/team-chat?channel=${sourceMessage.channelKey}&message=${sourceMessage.id}`} className="inline-flex min-h-11 items-center t-label underline">Вернуться к сообщению</Link>
    </section> : null}
    <TasksWorkspace
      filters={filters}
      queue={queue}
      cutOff={workspace.queue.cutOff}
      day={day}
      nowIso={now.toISOString()}
      canReadStaffTasks={workspace.canReadStaffTasks}
      canReadCaseTasks={workspace.canReadCaseTasks}
      teamView={access.teamView}
      createdExcludesCases={workspace.createdExcludesCases}
      composer={composerProps}
      composerKey={sourceMessage?.id ?? "standalone"}
      canCreate={canCreate}
      urlIntent={openIntent ?? single(params, "create") ?? null}
      permissions={permissions}
      selectedKey={selectedKey}
      taskLeads={taskLeads}
      dial={listDial}
      panel={panel}
    />
    </>}
    </PartShell>
  </>;
}
