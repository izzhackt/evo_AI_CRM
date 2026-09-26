"use server";

/**
 * «Закрыть лид» / «Завершить дело» и «Вернуть в работу» (migration 246).
 * Form-action shape of platform-case-next-action-actions.ts: exact fields, a
 * request id the form round-trips, Admin role preview never writes, and only
 * the confirmed receipt produces «сохранено». An unknown outcome keeps the
 * same request id so the retry replays the original write instead of making a
 * second one. The permission checks here are hints; SQL decides.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import { requirePlatformStaffActor } from "./platform-guards";
import {
  PlatformClosureError,
  closureNoteInput,
  parseCaseCloseOutcome,
  parseClosureUuid,
  parseClosureVersion,
  parseLeadCloseReason,
  setCaseClosed,
  setLeadClosed,
  type CaseClosureReceipt,
  type ClosureStatus,
  type LeadClosureReceipt,
} from "./platform-closure";
import { exactActionStringFields } from "./server/action-form-fields";
import { closureOutcome } from "./v3/wording";

export type ClosureActionState<Receipt> = Readonly<{
  status: "idle" | ClosureStatus;
  requestId: string;
  /** Honest Russian outcome for the form; null while idle. */
  message: string | null;
  receipt: Receipt | null;
}>;

export type LeadClosureActionState = ClosureActionState<LeadClosureReceipt>;
export type CaseClosureActionState = ClosureActionState<CaseClosureReceipt>;

const LEAD_FIELDS = ["lead_id", "expected_version", "closed", "reason", "note", "request_id"] as const;
const CASE_FIELDS = ["student_case_id", "expected_version", "closed", "outcome", "note", "request_id"] as const;

function refusal<Receipt>(
  kind: "lead" | "case",
  closed: boolean,
  status: Exclude<ClosureStatus, "saved">,
  requestId: string | null,
): ClosureActionState<Receipt> {
  // A request id is bound only by a committed write; after a refusal the same
  // id is still unused, except when the RPC reports it was used differently.
  const next = status === "request_conflict" || requestId === null ? randomUUID() : requestId;
  return { status, requestId: next, message: closureOutcome(status, kind, closed), receipt: null };
}

function parseClosedFlag(value: string | undefined): boolean | null {
  return value === "true" ? true : value === "false" ? false : null;
}

export async function leadClosureAction(
  _previous: LeadClosureActionState,
  form: FormData,
): Promise<LeadClosureActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, LEAD_FIELDS);
  const requestId = parseClosureUuid(fields?.get("request_id"));
  const closed = parseClosedFlag(fields?.get("closed")) ?? true;
  if (isStaffPreview(actor)) return refusal("lead", closed, "preview", requestId);
  if (!staffHasPermission(actor, "lead.sales.workflow.manage")) return refusal("lead", closed, "forbidden", requestId);
  const leadId = parseClosureUuid(fields?.get("lead_id"));
  const version = parseClosureVersion(fields?.get("expected_version"));
  const flag = parseClosedFlag(fields?.get("closed"));
  const reason = flag ? parseLeadCloseReason(fields?.get("reason")) : null;
  const note = flag ? closureNoteInput(reason, fields?.get("note") ?? "") : { ok: true as const, note: null };
  if (!fields || !requestId || !leadId || version === null || flag === null || !note.ok
    || (!flag && (fields.get("reason") !== "" || fields.get("note") !== ""))) {
    return refusal("lead", closed, "invalid", requestId);
  }
  try {
    const receipt = await setLeadClosed(actor, {
      leadId, expectedWorkflowVersion: version, closed: flag, reason, note: note.note, requestId,
    });
    revalidatePath("/v3/pipeline");
    revalidatePath("/v3/profile");
    return { status: "saved", requestId: randomUUID(), message: closureOutcome("saved", "lead", flag), receipt };
  } catch (error) {
    return refusal("lead", flag, error instanceof PlatformClosureError ? error.status : "unavailable", requestId);
  }
}

export async function caseClosureAction(
  _previous: CaseClosureActionState,
  form: FormData,
): Promise<CaseClosureActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, CASE_FIELDS);
  const requestId = parseClosureUuid(fields?.get("request_id"));
  const closed = parseClosedFlag(fields?.get("closed")) ?? true;
  if (isStaffPreview(actor)) return refusal("case", closed, "preview", requestId);
  if (!staffHasPermission(actor, "case.lifecycle.change")) return refusal("case", closed, "forbidden", requestId);
  const studentCaseId = parseClosureUuid(fields?.get("student_case_id"));
  const version = parseClosureVersion(fields?.get("expected_version"));
  const flag = parseClosedFlag(fields?.get("closed"));
  const outcome = flag ? parseCaseCloseOutcome(fields?.get("outcome")) : null;
  const note = flag ? closureNoteInput(outcome, fields?.get("note") ?? "") : { ok: true as const, note: null };
  if (!fields || !requestId || !studentCaseId || version === null || flag === null || !note.ok
    || (!flag && (fields.get("outcome") !== "" || fields.get("note") !== ""))) {
    return refusal("case", closed, "invalid", requestId);
  }
  try {
    const receipt = await setCaseClosed(actor, {
      studentCaseId, expectedVersion: version, closed: flag, outcome, note: note.note, requestId,
    });
    revalidatePath("/v3/profile");
    revalidatePath("/v3/admissions-pipeline");
    return { status: "saved", requestId: randomUUID(), message: closureOutcome("saved", "case", flag), receipt };
  } catch (error) {
    return refusal("case", flag, error instanceof PlatformClosureError ? error.status : "unavailable", requestId);
  }
}
