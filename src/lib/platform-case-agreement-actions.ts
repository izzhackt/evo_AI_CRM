"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { isStaffPreview } from "./platform-access.ts";
import { decimalToMinor, financeDateTime } from "./platform-finance-entry-contract";
import type { CaseAgreementState } from "./platform-case-agreement-contract";
import { parseSalesDate, parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { recordCasePayment, saveCaseTranche } from "./v3/case-agreement-source";

// Same useActionState + requestId + frozen-retry pattern
// FinanceEntryForms.tsx/platform-finance-entry-actions.ts already use (pinned
// by tests/sales-finance-entry.test.mjs) — reused here for the new block's
// two write forms, not re-invented.

export async function saveCaseTrancheAction(
  previous: CaseAgreementState,
  form: FormData,
): Promise<CaseAgreementState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, [
    "request_id",
    "student_case_id",
    "payment_obligation_id",
    "amount",
    "currency",
    "due_on",
    "label",
    "archive",
  ]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: CaseAgreementState["status"]): CaseAgreementState => ({
    status,
    requestId: requestId ?? previous.requestId,
    resourceId: null,
  });
  if (!fields || !requestId) return fail("invalid");
  if (isStaffPreview(actor)) return fail("forbidden");
  const text = (key: string) => fields.get(key)!.trim();
  const studentCaseId = parseSalesUuid(text("student_case_id"));
  const obligationId = text("payment_obligation_id")
    ? parseSalesUuid(text("payment_obligation_id"))
    : null;
  const archive = text("archive") === "true";
  const amountRaw = text("amount");
  const amount = amountRaw ? decimalToMinor(amountRaw) : null;
  const currency = text("currency") ? text("currency").toUpperCase() : null;
  const dueOnRaw = text("due_on");
  const dueOn = dueOnRaw ? parseSalesDate(dueOnRaw) : null;
  const label = text("label");
  if (
    !studentCaseId ||
    (text("payment_obligation_id") && !obligationId) ||
    (amountRaw && !amount) ||
    (currency && !/^[A-Z]{3}$/.test(currency)) ||
    (dueOnRaw && !dueOn) ||
    label.length > 500 ||
    [...fields.values()].some((value) =>
      value.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    )
  ) {
    return fail("invalid");
  }
  try {
    const state = await saveCaseTranche(actor, requestId, {
      p_student_case_id: studentCaseId,
      p_payment_obligation_id: obligationId,
      p_amount_minor: amount,
      p_currency: currency,
      p_due_on: dueOn,
      p_label: label || null,
      p_archive: archive,
    });
    if (state.status === "saved") {
      revalidatePath("/v3/profile");
      revalidatePath("/v3/main");
    }
    return state;
  } catch {
    return fail("unavailable");
  }
}

export async function recordCasePaymentAction(
  previous: CaseAgreementState,
  form: FormData,
): Promise<CaseAgreementState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, [
    "request_id",
    "student_case_id",
    "payment_obligation_id",
    "amount",
    "currency",
    "at",
    "note",
  ]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  const fail = (status: CaseAgreementState["status"]): CaseAgreementState => ({
    status,
    requestId: requestId ?? previous.requestId,
    resourceId: null,
  });
  if (!fields || !requestId) return fail("invalid");
  if (isStaffPreview(actor)) return fail("forbidden");
  const text = (key: string) => fields.get(key)!.trim();
  const studentCaseId = parseSalesUuid(text("student_case_id"));
  const obligationId = parseSalesUuid(text("payment_obligation_id"));
  const amount = decimalToMinor(text("amount"));
  const currency = text("currency").toUpperCase();
  // "at" reuses the same datetime-local Bishkek-wall-clock parser the
  // admin ledger form already uses, then the card only needs the calendar
  // date part — occurred_on is a DATE, not a timestamp.
  const occurredAtIso = financeDateTime(text("at"));
  const occurredOn = occurredAtIso ? occurredAtIso.slice(0, 10) : null;
  const note = text("note");
  if (
    !studentCaseId || !obligationId || !amount || !occurredOn ||
    !/^[A-Z]{3}$/.test(currency) || note.length > 1000 ||
    [...fields.values()].some((value) =>
      value.length > 2000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    )
  ) {
    return fail("invalid");
  }
  try {
    const state = await recordCasePayment(actor, requestId, {
      p_student_case_id: studentCaseId,
      p_payment_obligation_id: obligationId,
      p_amount_minor: amount,
      p_currency: currency,
      p_occurred_on: occurredOn,
      p_note: note || null,
    });
    if (state.status === "saved") {
      revalidatePath("/v3/profile");
      revalidatePath("/v3/main");
    }
    return state;
  } catch {
    return fail("unavailable");
  }
}
