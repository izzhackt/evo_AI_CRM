/**
 * «Студенты» work queue — server reads and the «Следующий шаг» write over
 * migration 241. Decoding lives in platform-student-case-queue-contract.ts;
 * this module only authorizes the section, calls the RPC and maps failures.
 * Authorization of every row and every write stays in the SQL functions:
 * the UI capability checks here are hints, never the security boundary.
 */
import { staffCan } from "./platform-access.ts";
import type { PlatformActor } from "./platform-auth";
import {
  buildStudentCaseQueueCountsRpcArguments,
  buildStudentCaseQueueRpcArguments,
  caseNextActionStatusFromRpcError,
  normalizeCaseNextActionReceipt,
  normalizeStudentCaseQueueCounts,
  normalizeStudentCaseQueuePage,
  parseExpectedAdmissionsVersion,
  parseQueueUuid,
  StudentCaseQueueContractError,
  type CaseNextActionInput,
  type CaseNextActionReceipt,
  type CaseNextActionStatus,
  type StudentCaseQueueCounts,
  type StudentCaseQueueFilters,
  type StudentCaseQueuePage,
  type StudentCaseQueueRequest,
  type StudentCaseQueueView,
} from "./platform-student-case-queue-contract.ts";

export * from "./platform-student-case-queue-contract.ts";

export class PlatformCaseNextActionError extends Error {
  readonly status: Exclude<CaseNextActionStatus, "saved">;

  constructor(status: Exclude<CaseNextActionStatus, "saved">) {
    super("Case next action update failed.");
    this.name = "PlatformCaseNextActionError";
    this.status = status;
  }
}

function unavailable(): never {
  throw new StudentCaseQueueContractError();
}

/**
 * Сервер отказал в чтении очереди (42501): у учётной записи нет полномочий
 * очереди. Это не сбой — повтор тем же запросом не поможет.
 */
export class StudentCaseQueueForbiddenError extends Error {
  constructor() {
    super("Student case queue read is forbidden.");
    this.name = "StudentCaseQueueForbiddenError";
  }
}

function requireQueueOrganization(actor: PlatformActor): string {
  if (!staffCan(actor, "admissions.read")) return unavailable();
  return parseQueueUuid(actor.organizationId) ?? unavailable();
}

async function getPlatformClient() {
  if (typeof window !== "undefined") return unavailable();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

export async function readStudentCaseQueue(
  actor: PlatformActor,
  request: StudentCaseQueueRequest,
): Promise<StudentCaseQueuePage> {
  try {
    requireQueueOrganization(actor);
    const args = buildStudentCaseQueueRpcArguments(request);
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc("staff_student_case_queue_v1", args, { get: true });
    if (response.error?.code === "42501") throw new StudentCaseQueueForbiddenError();
    if (response.error) return unavailable();
    return normalizeStudentCaseQueuePage(response.data, request);
  } catch (error) {
    if (error instanceof StudentCaseQueueForbiddenError) throw error;
    return unavailable();
  }
}

export async function readStudentCaseQueueCounts(
  actor: PlatformActor,
  view: StudentCaseQueueView,
  filters: StudentCaseQueueFilters = {},
): Promise<StudentCaseQueueCounts> {
  try {
    requireQueueOrganization(actor);
    const args = buildStudentCaseQueueCountsRpcArguments(view, filters);
    const client = await getPlatformClient();
    const response = await client.schema("platform").rpc("staff_student_case_queue_counts_v1", args, { get: true });
    if (response.error) return unavailable();
    return normalizeStudentCaseQueueCounts(response.data, view);
  } catch {
    return unavailable();
  }
}

export type SetCaseNextActionCommand = CaseNextActionInput &
  Readonly<{
    studentCaseId: string;
    expectedVersion: string;
    requestId: string;
  }>;

/**
 * One write through platform.set_case_next_action_v1. A thrown
 * PlatformCaseNextActionError carries the honest outcome; "unavailable" means
 * the result is unknown (the write may have committed), so the caller must
 * retry with the SAME request id — the RPC replays it without a second write.
 */
export async function setCaseNextAction(
  actor: PlatformActor,
  command: SetCaseNextActionCommand,
): Promise<CaseNextActionReceipt> {
  const organizationId = parseQueueUuid(actor.organizationId);
  const studentCaseId = parseQueueUuid(command.studentCaseId);
  const requestId = parseQueueUuid(command.requestId);
  const expectedVersion = parseExpectedAdmissionsVersion(command.expectedVersion);
  if (!organizationId || !studentCaseId || !requestId || expectedVersion === null) {
    throw new PlatformCaseNextActionError("invalid");
  }
  let response;
  try {
    const client = await getPlatformClient();
    response = await client.schema("platform").rpc("set_case_next_action_v1", {
      p_organization_id: organizationId,
      p_student_case_id: studentCaseId,
      // Decimal text keeps the full bigint range; PostgREST casts it to BIGINT.
      p_expected_version: expectedVersion,
      p_next_action: command.nextAction,
      p_next_action_due_on: command.dueOn,
      p_request_id: requestId,
    });
  } catch {
    throw new PlatformCaseNextActionError("unavailable");
  }
  if (response.error) throw new PlatformCaseNextActionError(caseNextActionStatusFromRpcError(response.error));
  try {
    return normalizeCaseNextActionReceipt(response.data, { organizationId, studentCaseId, requestId });
  } catch {
    // A malformed receipt may follow a committed write: unknown, not failed.
    throw new PlatformCaseNextActionError("unavailable");
  }
}
