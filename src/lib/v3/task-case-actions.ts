"use server";

import { fixedRoleCan } from "../fixed-role-policy";
import { listPlatformStudentCases, parsePlatformAdmissionsCursor, type PlatformAdmissionsCursor } from "../platform-admissions";
import { requirePlatformStaffActor } from "../platform-guards";

/** Paginated canonical case search; Sales never receives the Admissions projection. */
export async function searchTaskCasesAction(query: string, cursor: PlatformAdmissionsCursor | null) {
  const actor = await requirePlatformStaffActor();
  if (!fixedRoleCan(actor.authorityRole, "admissions.read") || !["admin", "admissions"].includes(actor.presentationRole)) {
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
