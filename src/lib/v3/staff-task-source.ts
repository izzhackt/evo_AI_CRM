import { isStaffPreview, staffHasPermission, staffPresentationCan } from "../platform-access.ts";
import "server-only";

import type { ActivePlatformActor } from "../platform-auth";
import type { PlatformAdmissionsTaskQueueCursor, PlatformAdmissionsTaskQueueRow } from "../platform-admissions-task-contract";
import type { getPlatformAdmissionsTaskWorkspace, listPlatformAdmissionsTaskQueue } from "../platform-admissions-workspace";
import type { listPlatformStudentCases } from "../platform-admissions";
import type { listStaffParticipants, listStaffTaskAssignees, listStaffTasks } from "../server/platform-staff-task-repository";
import type { StaffTask, StaffTaskCursor, StaffTaskFilter, StaffTaskView } from "../platform-staff-task-contract";

/** Only the read model is unified. Each kind retains its canonical write path. */
export type WorkspaceTask =
  | Readonly<{ kind: "staff"; task: StaffTask }>
  | Readonly<{ kind: "case"; task: PlatformAdmissionsTaskQueueRow }>;

type StaffTaskWorkspaceReaders = Readonly<{
  listStaffParticipants: typeof listStaffParticipants;
  listStaffTaskAssignees: typeof listStaffTaskAssignees;
  listStaffTasks: typeof listStaffTasks;
  listPlatformAdmissionsTaskQueue: typeof listPlatformAdmissionsTaskQueue;
  listPlatformStudentCases: typeof listPlatformStudentCases;
  getPlatformAdmissionsTaskWorkspace: typeof getPlatformAdmissionsTaskWorkspace;
}>;

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

export async function readStaffTaskWorkspace(actor: ActivePlatformActor, options: Readonly<{
  view: StaffTaskView; status: StaffTaskFilter; cursor: StaffTaskCursor | null;
  caseCursor: PlatformAdmissionsTaskQueueCursor | null; domain: "staff" | "case";
  taskId: string | null; selectedCaseId: string | null;
}>, dependencies: Readonly<{ readers?: StaffTaskWorkspaceReaders }> = {}) {
  const { listStaffParticipants, listStaffTaskAssignees, listStaffTasks,
    listPlatformAdmissionsTaskQueue, listPlatformStudentCases,
    getPlatformAdmissionsTaskWorkspace } = dependencies.readers ?? await productionReaders();
  const canReadCases = staffPresentationCan(actor, "admissions.read");
  const canReadCaseTasks = staffHasPermission(actor, "task.manage") && (!isStaffPreview(actor) || canReadCases);
  const canReadStaffTasks = staffHasPermission(actor, "staff.task.read");
  const canReadStaffDirectory = ["staff.task.read", "staff.task.create", "staff.task.edit", "staff.task.complete"].some(key => staffHasPermission(actor, key));
  const [participants, assignees] = await Promise.all([
    canReadStaffDirectory ? listStaffParticipants(actor) : [],
    !isStaffPreview(actor) && (options.taskId ? staffHasPermission(actor, "staff.task.edit") : staffHasPermission(actor, "staff.task.create"))
      ? listStaffTaskAssignees(actor, options.taskId) : [],
  ]);
  const [staffPage, casePage, selectedTaskPage, selectedCasePage] = await Promise.all([
    options.domain === "staff" && canReadStaffTasks ? listStaffTasks(actor, options) : null,
    options.domain === "case" && canReadCaseTasks ? listPlatformAdmissionsTaskQueue(actor, { pageSize: 50, cursor: options.caseCursor }) : null,
    options.taskId && canReadStaffTasks ? listStaffTasks(actor, { view: "all", status: "all", taskId: options.taskId }) : null,
    canReadCases && options.selectedCaseId ? listPlatformStudentCases(actor, { studentCaseId: options.selectedCaseId, state: "active", pageSize: 1 }) : null,
  ]);
  const caseRow = selectedCasePage?.rows[0];
  const caseWorkspace = options.selectedCaseId && canReadCases && staffHasPermission(actor, "task.create")
    ? await getPlatformAdmissionsTaskWorkspace(actor, options.selectedCaseId) : null;
  return {
    tasks: [...(staffPage?.rows.map((task): WorkspaceTask => ({ kind: "staff", task })) ?? []), ...(casePage?.rows.map((task): WorkspaceTask => ({ kind: "case", task })) ?? [])],
    nextCursor: staffPage?.nextCursor ?? null, caseNextCursor: casePage?.nextCursor ?? null,
    selectedTask: selectedTaskPage?.rows[0] ?? null,
    selectedCase: caseRow?.access === "full" && caseRow.studentCase.state === "active" ? { id: caseRow.studentCase.studentCaseId, name: caseRow.studentCase.studentDisplayName } : null,
    participants, assignees, canReadCases, canReadCaseTasks, canReadStaffTasks,
    caseAssignees: caseWorkspace?.assignees.map(({ membershipId, displayName }) => ({ membershipId, displayName })) ?? [],
  };
}
