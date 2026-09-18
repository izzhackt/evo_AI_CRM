import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../supabase/server";
import {
  isStudentApplicationRecord, isStudentApplicationUuid, STUDENT_APPLICATION_DIRECTIONS,
  validateStudentApplicationDraft, type AdmissionsDirection, type StudentApplication,
  type StudentApplicationDraft, type StudentApplicationQueue,
} from "../student-application-contract";

export class StudentApplicationSourceError extends Error {
  constructor(public readonly code: "forbidden" | "conflict" | "invalid" | "unavailable") {
    super("Student application data is unavailable.");
    this.name = "StudentApplicationSourceError";
  }
}
function fail(): never { throw new StudentApplicationSourceError("unavailable"); }
function date(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function direction(value: unknown): value is AdmissionsDirection {
  return typeof value === "string" && (STUDENT_APPLICATION_DIRECTIONS as readonly string[]).includes(value);
}
export function decodeStudentApplication(value: unknown): StudentApplication {
  if (!isStudentApplicationRecord(value) || Object.keys(value).sort().join(",") !== "admissions_direction,decided_at,decision_reason,email,id,questionnaire,revision,status,student_case_id,submitted_at") return fail();
  const questionnaire = validateStudentApplicationDraft(value.questionnaire);
  const revision = Number(value.revision);
  if (!isStudentApplicationUuid(value.id) || !["pending", "approved", "rejected"].includes(String(value.status))
    || !Number.isSafeInteger(revision) || revision < 1 || !questionnaire
    || typeof value.email !== "string" || value.email.length > 320 || !value.email.includes("@")
    || !date(value.submitted_at) || (value.decided_at !== null && !date(value.decided_at))
    || (value.decision_reason !== null && (typeof value.decision_reason !== "string" || value.decision_reason.length > 1000))
    || (value.student_case_id !== null && !isStudentApplicationUuid(value.student_case_id))
    || (value.admissions_direction !== null && !direction(value.admissions_direction))) return fail();
  if ((value.status === "approved") !== (value.student_case_id !== null)
    || (value.status === "pending") !== (value.decided_at === null)
    || (value.status === "approved") !== (value.admissions_direction !== null)) return fail();
  return { id: value.id, status: value.status as StudentApplication["status"], revision, email: value.email,
    questionnaire, submittedAt: value.submitted_at, decidedAt: value.decided_at as string | null,
    decisionReason: value.decision_reason as string | null, studentCaseId: value.student_case_id as string | null,
    admissionsDirection: value.admissions_direction as AdmissionsDirection | null };
}
async function rpc(client: SupabaseClient, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const result = await client.schema("platform").rpc(name, args);
  if (result.error) {
    const code = result.error.code;
    throw new StudentApplicationSourceError(code === "42501" ? "forbidden"
      : code === "40001" || code === "23505" || code === "PT409" ? "conflict"
        : code === "22023" ? "invalid" : "unavailable");
  }
  return result.data;
}
export async function readOwnStudentApplication(client?: SupabaseClient): Promise<StudentApplication | null> {
  const data = await rpc(client ?? await createSupabaseServerClient(), "own_student_application_v1");
  return data === null ? null : decodeStudentApplication(data);
}
export const loadOwnStudentApplication = readOwnStudentApplication;
export async function submitStudentApplication(client: SupabaseClient, draft: StudentApplicationDraft, expectedRevision = 0): Promise<StudentApplication> {
  if (!validateStudentApplicationDraft(draft) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new StudentApplicationSourceError("invalid");
  return decodeStudentApplication(await rpc(client, "submit_student_application_v1", {
    p_request_id: draft.requestId, p_questionnaire: draft, p_expected_revision: expectedRevision,
  }));
}
export async function loadStudentApplicationQueue(): Promise<StudentApplicationQueue> {
  const data = await rpc(await createSupabaseServerClient(), "staff_student_applications_v1");
  if (!isStudentApplicationRecord(data) || Object.keys(data).sort().join(",") !== "applications,curators,pending_count"
    || !Array.isArray(data.applications) || data.applications.length > 100 || !Array.isArray(data.curators) || data.curators.length > 100
    || !Number.isSafeInteger(data.pending_count) || Number(data.pending_count) < 0) return fail();
  const applications = data.applications.map(decodeStudentApplication);
  const curators = data.curators.map((row) => {
    if (!isStudentApplicationRecord(row) || Object.keys(row).sort().join(",") !== "directions,display_name,membership_id"
      || !isStudentApplicationUuid(row.membership_id) || typeof row.display_name !== "string" || !row.display_name.trim() || row.display_name.length > 200
      || !Array.isArray(row.directions) || row.directions.length < 1 || row.directions.length > 5 || !row.directions.every(direction)) return fail();
    return { membershipId: row.membership_id, displayName: row.display_name, directions: row.directions as AdmissionsDirection[] };
  });
  if (new Set(applications.map((a) => a.id)).size !== applications.length || new Set(curators.map((c) => c.membershipId)).size !== curators.length) return fail();
  return { applications, curators, pendingCount: data.pending_count as number };
}
export async function loadStudentApplicationPendingCount(): Promise<number> {
  const data = await rpc(await createSupabaseServerClient(), "staff_student_application_pending_count_v1");
  if (!Number.isSafeInteger(data) || Number(data) < 0) return fail();
  return data as number;
}
export async function loadStudentApplicationForCase(caseId: string): Promise<StudentApplication | null> {
  if (!isStudentApplicationUuid(caseId)) throw new StudentApplicationSourceError("invalid");
  const data = await rpc(await createSupabaseServerClient(), "staff_student_application_for_case_v1", { p_student_case_id: caseId });
  return data === null ? null : decodeStudentApplication(data);
}
export async function decideStudentApplication(input: {
  applicationId: string; expectedRevision: number; decision: "approve" | "reject";
  admissionsDirection: AdmissionsDirection | null; curatorMembershipId: string | null; reason: string; requestId: string;
}): Promise<StudentApplication> {
  return decodeStudentApplication(await rpc(await createSupabaseServerClient(), "decide_student_application_v1", {
    p_application_id: input.applicationId, p_expected_revision: input.expectedRevision, p_decision: input.decision,
    p_admissions_direction: input.admissionsDirection, p_curator_membership_id: input.curatorMembershipId,
    p_reason: input.reason, p_request_id: input.requestId,
  }));
}
