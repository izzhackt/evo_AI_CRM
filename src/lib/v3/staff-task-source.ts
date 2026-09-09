import "server-only";

import type { ActivePlatformActor } from "../platform-auth";
import type { PlatformAdmissionsTaskQueueCursor, PlatformAdmissionsTaskQueueRow } from "../platform-admissions-task-contract";
import { listPlatformAdmissionsTaskQueue } from "../platform-admissions-workspace";
import { listPlatformStudentCases } from "../platform-admissions";
import { listStaffParticipants, listStaffTasks } from "../server/platform-staff-task-repository";
import type { StaffTask, StaffTaskCursor, StaffTaskFilter, StaffTaskView } from "../platform-staff-task-contract";

/** Only the read model is unified. Each kind retains its canonical write path. */
export type WorkspaceTask =
  | Readonly<{ kind: "staff"; task: StaffTask }>
  | Readonly<{ kind: "case"; task: PlatformAdmissionsTaskQueueRow }>;

export async function readStaffTaskWorkspace(actor: ActivePlatformActor, options: Readonly<{
  view: StaffTaskView; status: StaffTaskFilter; cursor: StaffTaskCursor | null;
  caseCursor: PlatformAdmissionsTaskQueueCursor | null; domain: "staff" | "case";
  taskId: string | null; selectedCaseId: string | null;
}>) {
  const canReadCases = ["admin", "admissions"].includes(actor.authorityRole) && ["admin", "admissions"].includes(actor.presentationRole);
  if (options.domain === "case" && !canReadCases) throw new Error("Case tasks are unavailable.");
  const participants = await listStaffParticipants(actor);
  const assignees = participants.filter((person) => actor.authorityRole === "admin" || person.role === actor.authorityRole);
  const [staffPage, casePage, selectedTaskPage, selectedCasePage] = await Promise.all([
    options.domain === "staff" ? listStaffTasks(actor, options) : null,
    options.domain === "case" ? listPlatformAdmissionsTaskQueue(actor, { pageSize: 50, cursor: options.caseCursor }) : null,
    options.taskId ? listStaffTasks(actor, { view: "all", status: "all", taskId: options.taskId }) : null,
    canReadCases && options.selectedCaseId ? listPlatformStudentCases(actor, { studentCaseId: options.selectedCaseId, state: "active", pageSize: 1 }) : null,
  ]);
  const caseRow = selectedCasePage?.rows[0];
  return {
    tasks: [...(staffPage?.rows.map((task): WorkspaceTask => ({ kind: "staff", task })) ?? []), ...(casePage?.rows.map((task): WorkspaceTask => ({ kind: "case", task })) ?? [])],
    nextCursor: staffPage?.nextCursor ?? null, caseNextCursor: casePage?.nextCursor ?? null,
    selectedTask: selectedTaskPage?.rows[0] ?? null,
    selectedCase: caseRow?.access === "full" && caseRow.studentCase.state === "active" ? { id: caseRow.studentCase.studentCaseId, name: caseRow.studentCase.studentDisplayName } : null,
    participants, assignees, canReadCases,
  };
}
