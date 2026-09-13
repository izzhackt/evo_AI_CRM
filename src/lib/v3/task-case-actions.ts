"use server";

import { isStaffPreview, staffHasPermission, staffPresentationCan } from "../platform-access.ts";
import { listPlatformStudentCases, parsePlatformAdmissionsCursor, parsePlatformAdmissionsUuid, type PlatformAdmissionsCursor } from "../platform-admissions";
import { getPlatformAdmissionsTaskWorkspace } from "../platform-admissions-workspace";
import { requirePlatformStaffActor } from "../platform-guards";

/** Paginated canonical case search; Sales never receives the Admissions projection. */
export async function searchTaskCasesAction(query: string, cursor: PlatformAdmissionsCursor | null) {
  const actor = await requirePlatformStaffActor();
  if (!staffPresentationCan(actor, "admissions.read")) {
    return { status: "forbidden" as const, rows: [], nextCursor: null };
  }
  if (typeof query !== "string" || query.length > 200 || (cursor !== null && !parsePlatformAdmissionsCursor(cursor?.sortAt, cursor?.id))) {
    return { status: "invalid" as const, rows: [], nextCursor: null };
  }
  try {
    const page = await listPlatformStudentCases(actor, { query: query.trim(), state: "active", pageSize: 20, cursor });
    if (page.rows.some((row) => row.access !== "full")) throw new Error("Case access unavailable");
    return { status: "ready" as const, rows: page.rows.flatMap((row) => row.access === "full" ? [{ id: row.studentCase.studentCaseId, name: row.studentCase.studentDisplayName }] : []), nextCursor: page.nextCursor };
  } catch {
    return { status: "unavailable" as const, rows: [], nextCursor: null };
  }
}

/** Candidate eligibility belongs to this exact case, not a global staff list. */
export async function readTaskCaseAssigneesAction(caseId: string) {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffPresentationCan(actor, "admissions.read")
    || (!staffHasPermission(actor, "task.create") && !staffHasPermission(actor, "task.manage"))) {
    return { status: "forbidden" as const, assignees: [] };
  }
  if (!parsePlatformAdmissionsUuid(caseId)) return { status: "invalid" as const, assignees: [] };
  try {
    const workspace = await getPlatformAdmissionsTaskWorkspace(actor, caseId);
    return { status: "ready" as const, assignees: workspace.assignees.map(({ membershipId, displayName }) => ({ membershipId, displayName })) };
  } catch {
    return { status: "unavailable" as const, assignees: [] };
  }
}
