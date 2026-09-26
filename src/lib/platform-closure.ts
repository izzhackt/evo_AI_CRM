/**
 * «Закрыть лид» и «Завершить дело» — server calls of migration 246. Decoding
 * lives in platform-closure-contract.ts; this module only calls the RPCs and
 * maps failures. Every permission, scope and state rule is decided in SQL:
 * the capability checks of the callers are hints, never the boundary.
 */
import type { PlatformActor } from "./platform-auth";
import {
  ClosureContractError,
  closureStatusFromRpcError,
  normalizeCaseClosure,
  normalizeCaseClosureReceipt,
  normalizeClosedLeadsPage,
  normalizeLeadClosureReceipt,
  parseClosedLeadsCursor,
  parseClosureUuid,
  parseClosureVersion,
  type CaseClosure,
  type CaseClosureReceipt,
  type CaseCloseOutcome,
  type ClosedLeadsPage,
  type ClosureStatus,
  type LeadCloseReason,
  type LeadClosureReceipt,
} from "./platform-closure-contract.ts";

export * from "./platform-closure-contract.ts";

/** Страница «Закрытых» лидов доски. */
export const CLOSED_LEADS_PAGE_SIZE = 50;

export class PlatformClosureError extends Error {
  readonly status: Exclude<ClosureStatus, "saved">;

  constructor(status: Exclude<ClosureStatus, "saved">) {
    super("Closure command failed.");
    this.name = "PlatformClosureError";
    this.status = status;
  }
}

async function getPlatformClient() {
  if (typeof window !== "undefined") throw new ClosureContractError();
  const { createSupabaseServerClient } = await import("./supabase/server");
  return createSupabaseServerClient();
}

function organizationOf(actor: PlatformActor): string {
  return parseClosureUuid(actor.organizationId) ?? (() => { throw new PlatformClosureError("invalid"); })();
}

export type SetLeadClosedCommand = Readonly<{
  leadId: string;
  expectedWorkflowVersion: string;
  closed: boolean;
  reason: LeadCloseReason | null;
  note: string | null;
  requestId: string;
}>;

/**
 * One write through platform.set_lead_closed_v1. "unavailable" means the
 * result is unknown (the write may have committed): retry with the SAME
 * request id — the RPC replays it without a second write.
 */
export async function setLeadClosed(actor: PlatformActor, command: SetLeadClosedCommand): Promise<LeadClosureReceipt> {
  const organizationId = organizationOf(actor);
  const leadId = parseClosureUuid(command.leadId);
  const requestId = parseClosureUuid(command.requestId);
  const version = parseClosureVersion(command.expectedWorkflowVersion);
  if (!leadId || !requestId || version === null || version === "0") throw new PlatformClosureError("invalid");
  let response;
  try {
    const client = await getPlatformClient();
    response = await client.schema("platform").rpc("set_lead_closed_v1", {
      p_organization_id: organizationId,
      p_lead_id: leadId,
      p_expected_workflow_version: version,
      p_closed: command.closed,
      p_reason: command.closed ? command.reason : null,
      p_note: command.closed ? command.note : null,
      p_request_id: requestId,
    });
  } catch {
    throw new PlatformClosureError("unavailable");
  }
  if (response.error) throw new PlatformClosureError(closureStatusFromRpcError(response.error));
  try {
    return normalizeLeadClosureReceipt(response.data, { organizationId, leadId, requestId, closed: command.closed });
  } catch {
    throw new PlatformClosureError("unavailable");
  }
}

export type SetCaseClosedCommand = Readonly<{
  studentCaseId: string;
  expectedVersion: string;
  closed: boolean;
  outcome: CaseCloseOutcome | null;
  note: string | null;
  requestId: string;
}>;

/** One write through platform.set_student_case_closed_v1 (same retry rule). */
export async function setCaseClosed(actor: PlatformActor, command: SetCaseClosedCommand): Promise<CaseClosureReceipt> {
  const organizationId = organizationOf(actor);
  const studentCaseId = parseClosureUuid(command.studentCaseId);
  const requestId = parseClosureUuid(command.requestId);
  const version = parseClosureVersion(command.expectedVersion);
  if (!studentCaseId || !requestId || version === null) throw new PlatformClosureError("invalid");
  let response;
  try {
    const client = await getPlatformClient();
    response = await client.schema("platform").rpc("set_student_case_closed_v1", {
      p_organization_id: organizationId,
      p_student_case_id: studentCaseId,
      p_expected_version: version,
      p_closed: command.closed,
      p_outcome: command.closed ? command.outcome : null,
      p_note: command.closed ? command.note : null,
      p_request_id: requestId,
    });
  } catch {
    throw new PlatformClosureError("unavailable");
  }
  if (response.error) throw new PlatformClosureError(closureStatusFromRpcError(response.error));
  try {
    return normalizeCaseClosureReceipt(response.data, { organizationId, studentCaseId, requestId, closed: command.closed });
  } catch {
    throw new PlatformClosureError("unavailable");
  }
}

/**
 * Закрытые лиды, которые сотрудник читает (`lead.read`). `leadId` — одна
 * запись для Lead 360 закрытого лида. Сбой чтения — исключение: вызывающий
 * показывает «не удалось», а не пустой список.
 */
export async function readClosedLeads(
  actor: PlatformActor,
  options: Readonly<{ cursor?: string | null; leadId?: string | null; limit?: number }> = {},
): Promise<ClosedLeadsPage> {
  const organizationId = organizationOf(actor);
  const limit = options.limit ?? CLOSED_LEADS_PAGE_SIZE;
  const cursor = options.cursor ? parseClosedLeadsCursor(options.cursor) : null;
  const leadId = options.leadId ? parseClosureUuid(options.leadId) : null;
  if ((options.cursor && !cursor) || (options.leadId && !leadId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ClosureContractError();
  }
  const client = await getPlatformClient();
  const response = await client.schema("platform").rpc("staff_closed_leads_v1", {
    p_limit: limit,
    ...(cursor ? { p_cursor: cursor } : {}),
    ...(leadId ? { p_lead_id: leadId } : {}),
  }, { get: true });
  if (response.error) throw new ClosureContractError();
  return normalizeClosedLeadsPage(response.data, organizationId, limit);
}

/** Закрытие одного дела для Student 360 и «Быстрого просмотра». */
export async function readCaseClosure(actor: PlatformActor, studentCaseId: string): Promise<CaseClosure> {
  const organizationId = organizationOf(actor);
  const caseId = parseClosureUuid(studentCaseId);
  if (!caseId) throw new ClosureContractError();
  const client = await getPlatformClient();
  const response = await client.schema("platform").rpc("staff_student_case_closure_v1", {
    p_organization_id: organizationId,
    p_student_case_id: caseId,
  }, { get: true });
  if (response.error) throw new ClosureContractError();
  return normalizeCaseClosure(response.data, organizationId, caseId);
}
