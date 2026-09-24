import { isStaffPreview, staffHasPermission, staffPresentationCan } from "../platform-access.ts";
import "server-only";

import type { ActivePlatformActor } from "../platform-auth";
import type { PlatformAdmissionsTaskQueueCursor, PlatformAdmissionsTaskQueueRow } from "../platform-admissions-task-contract";
import type { getPlatformAdmissionsTaskWorkspace, listPlatformAdmissionsTaskQueue } from "../platform-admissions-workspace";
import type { listPlatformStudentCases } from "../platform-admissions";
import type { listStaffParticipants, listStaffTaskAssignees, listStaffTasks } from "../server/platform-staff-task-repository";
import type { StaffTask, StaffTaskCursor } from "../platform-staff-task-contract";
import type { TaskQueueKind, TaskQueueState, TaskQueueView, TaskQueueWindow } from "./task-queue.ts";

type StaffTaskWorkspaceReaders = Readonly<{
  listStaffParticipants: typeof listStaffParticipants;
  listStaffTaskAssignees: typeof listStaffTaskAssignees;
  listStaffTasks: typeof listStaffTasks;
  listPlatformAdmissionsTaskQueue: typeof listPlatformAdmissionsTaskQueue;
  listPlatformStudentCases: typeof listPlatformStudentCases;
  getPlatformAdmissionsTaskWorkspace: typeof getPlatformAdmissionsTaskWorkspace;
}>;

/**
 * Предел одного чтения очереди при окне 1: рабочие задачи — 4 страницы по 50
 * (`staff_task_list` отдаёт их по дате изменения, поэтому сортировка по сроку
 * возможна только после полного чтения), задачи по студентам — 3 страницы по
 * 100 (`staff_case_task_queue` уже упорядочена по сроку). Окно 2 и 4
 * («Показать больше задач») умножает предел. Неполное чтение не прячется:
 * `complete` становится false, и экран называет это словами.
 */
export const TASK_QUEUE_READ_PAGES = Object.freeze({ staff: 4, case: 3 });
export const CASE_QUEUE_PAGE_SIZE = 100;

async function productionReaders(): Promise<StaffTaskWorkspaceReaders> {
  const [staff, admissions, workspace] = await Promise.all([
    import("../server/platform-staff-task-repository.ts"),
    import("../platform-admissions.ts"),
    import("../platform-admissions-workspace.ts"),
  ]);
  return {
    listStaffParticipants: staff.listStaffParticipants,
    listStaffTaskAssignees: staff.listStaffTaskAssignees,
    listStaffTasks: staff.listStaffTasks,
    listPlatformAdmissionsTaskQueue: workspace.listPlatformAdmissionsTaskQueue,
    listPlatformStudentCases: admissions.listPlatformStudentCases,
    getPlatformAdmissionsTaskWorkspace: workspace.getPlatformAdmissionsTaskWorkspace,
  };
}

export type StaffTaskWorkspaceOptions = Readonly<{
  view: TaskQueueView;
  state: TaskQueueState;
  /** null — оба вида; иначе ненужное чтение не выполняется. */
  type: TaskQueueKind | null;
  window: TaskQueueWindow;
  taskId: string | null;
  selectedCaseId: string | null;
}>;

/**
 * Права видны заранее: вкладка «Вся команда» — Admin, тем, кто ведёт задачи
 * по студентам (`task.manage`: куратор видит задачи своих дел, в том числе
 * назначенные коллегам), и руководителям с областью отдела или направления
 * (их `staff.task.read` шире собственных задач). Сотруднику с областью «свои»
 * «все доступные» совпали бы с «Мои» и «Поставил я», и вкладка обещала бы
 * больше, чем есть. Это подсказка интерфейса: строки по-прежнему отбирает сервер.
 */
export function taskQueueAccess(actor: ActivePlatformActor) {
  const canReadCases = staffPresentationCan(actor, "admissions.read");
  const canReadCaseTasks = staffHasPermission(actor, "task.manage") && (!isStaffPreview(actor) || canReadCases);
  const canReadStaffTasks = staffHasPermission(actor, "staff.task.read");
  const managesTeam = !isStaffPreview(actor) && canReadStaffTasks
    && actor.assignments.some((assignment) => assignment.scope.kind === "department" || assignment.scope.kind === "direction");
  return Object.freeze({ canReadCases, canReadCaseTasks, canReadStaffTasks, teamView: canReadCaseTasks || managesTeam });
}

export async function readStaffTaskWorkspace(
  actor: ActivePlatformActor,
  options: StaffTaskWorkspaceOptions,
  dependencies: Readonly<{ readers?: StaffTaskWorkspaceReaders }> = {},
) {
  const { listStaffParticipants, listStaffTaskAssignees, listStaffTasks,
    listPlatformAdmissionsTaskQueue, listPlatformStudentCases,
    getPlatformAdmissionsTaskWorkspace } = dependencies.readers ?? await productionReaders();
  const { canReadCases, canReadCaseTasks, canReadStaffTasks, teamView } = taskQueueAccess(actor);
  const canReadStaffDirectory = ["staff.task.read", "staff.task.create", "staff.task.edit", "staff.task.complete"].some(key => staffHasPermission(actor, key));
  const [participants, assignees] = await Promise.all([
    canReadStaffDirectory ? listStaffParticipants(actor) : [],
    !isStaffPreview(actor) && (options.taskId ? staffHasPermission(actor, "staff.task.edit") : staffHasPermission(actor, "staff.task.create"))
      ? listStaffTaskAssignees(actor, options.taskId) : [],
  ]);

  // Каждое чтение идёт страницами по своему курсору до конца или до предела.
  async function readStaffQueue(): Promise<Readonly<{ rows: readonly StaffTask[]; complete: boolean }>> {
    const rows: StaffTask[] = [];
    let cursor: StaffTaskCursor | null = null;
    for (let page = 0; page < TASK_QUEUE_READ_PAGES.staff * options.window; page += 1) {
      const result = await listStaffTasks(actor, { view: options.view, status: options.state === "done" ? "completed" : "active", cursor });
      rows.push(...result.rows);
      cursor = result.nextCursor;
      if (!cursor) return { rows, complete: true };
    }
    return { rows, complete: false };
  }
  async function readCaseQueue(): Promise<Readonly<{ rows: readonly PlatformAdmissionsTaskQueueRow[]; complete: boolean }>> {
    const rows: PlatformAdmissionsTaskQueueRow[] = [];
    let cursor: PlatformAdmissionsTaskQueueCursor | null = null;
    for (let page = 0; page < TASK_QUEUE_READ_PAGES.case * options.window; page += 1) {
      const result = await listPlatformAdmissionsTaskQueue(actor, { pageSize: CASE_QUEUE_PAGE_SIZE, cursor });
      rows.push(...result.rows);
      cursor = result.nextCursor;
      if (!cursor) return { rows, complete: true };
    }
    return { rows, complete: false };
  }

  // «Поставил я» у задач по студентам невозможен: строка очереди не несёт автора.
  const readsStaff = canReadStaffTasks && options.type !== "case";
  const readsCases = canReadCaseTasks && options.type !== "staff" && options.view !== "created";
  const [staffQueue, caseQueue, selectedTaskPage, selectedCasePage] = await Promise.all([
    readsStaff ? readStaffQueue() : null,
    readsCases ? readCaseQueue() : null,
    options.taskId && canReadStaffTasks ? listStaffTasks(actor, { view: "all", status: "all", taskId: options.taskId }) : null,
    canReadCases && options.selectedCaseId ? listPlatformStudentCases(actor, { studentCaseId: options.selectedCaseId, state: "active", pageSize: 1 }) : null,
  ]);
  const caseRow = selectedCasePage?.rows[0];
  const caseWorkspace = options.selectedCaseId && canReadCases && staffHasPermission(actor, "task.create")
    ? await getPlatformAdmissionsTaskWorkspace(actor, options.selectedCaseId) : null;
  return {
    queue: {
      staff: staffQueue?.rows ?? [],
      cases: caseQueue?.rows ?? [],
      complete: (staffQueue?.complete ?? true) && (caseQueue?.complete ?? true),
    },
    selectedTask: selectedTaskPage?.rows[0] ?? null,
    selectedCase: caseRow?.access === "full" && caseRow.studentCase.state === "active" ? { id: caseRow.studentCase.studentCaseId, name: caseRow.studentCase.studentDisplayName } : null,
    participants, assignees, canReadCases, canReadCaseTasks, canReadStaffTasks, teamView,
    createdExcludesCases: readsCases === false && canReadCaseTasks && options.view === "created" && options.type !== "staff",
    caseAssignees: caseWorkspace?.assignees.map(({ membershipId, displayName }) => ({ membershipId, displayName })) ?? [],
  };
}
