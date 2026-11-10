import "server-only";
import type { PlatformActor } from "../platform-auth";
import {
  parsePaymentDetailsAdmin,
  parseStudentReceiptQueue,
  type PaymentDetailsAdmin,
  type StudentReceiptActionState,
  type StudentReceiptQueue,
  type StudentReceiptStatus,
} from "../platform-student-receipts-contract";
import { parseSalesUuid } from "../platform-sales-register-contract";
import { createSupabaseServerClient } from "../supabase/server";

export type StudentReceiptQueueRead =
  | Readonly<{ status: "ok"; queue: StudentReceiptQueue }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "unavailable" }>;

/**
 * «Чеки на проверке» (миграция 358, `platform.staff_payment_receipts_v1`): очередь по всей организации либо по одному делу.
 * Что сотрудник видит и разбирает, решает база (то же чтение, что у блока «Договор и оплата»). 42501 - «нет права»,
 * честный отказ без пустого списка; любой другой сбой - «недоступно».
 */
export async function readStudentReceiptQueue(
  actor: PlatformActor,
  options: Readonly<{ studentCaseId?: string; status?: StudentReceiptStatus }> = {},
): Promise<StudentReceiptQueueRead> {
  const studentCaseId = options.studentCaseId === undefined ? null : parseSalesUuid(options.studentCaseId);
  if (options.studentCaseId !== undefined && !studentCaseId) return { status: "unavailable" };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("staff_payment_receipts_v1", {
      p_student_case_id: studentCaseId,
      p_status: options.status ?? "pending",
      p_limit: 200,
    });
    if (error) return { status: error.code === "42501" ? "forbidden" : "unavailable" };
    return { status: "ok", queue: parseStudentReceiptQueue(data, actor.organizationId) };
  } catch {
    return { status: "unavailable" };
  }
}

export type PaymentDetailsRead =
  | Readonly<{ status: "ok"; details: PaymentDetailsAdmin }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "unavailable" }>;

/** Реквизиты для оплаты в редакторе администратора (`platform.staff_payment_details_v1`); не администратор - 42501. */
export async function readPaymentDetailsAdmin(actor: PlatformActor): Promise<PaymentDetailsRead> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("staff_payment_details_v1");
    if (error) return { status: error.code === "42501" ? "forbidden" : "unavailable" };
    return { status: "ok", details: parsePaymentDetailsAdmin(data, actor.organizationId) };
  } catch {
    return { status: "unavailable" };
  }
}

function outcome(status: StudentReceiptActionState["status"], requestId: string, message: string | null = null): StudentReceiptActionState {
  return { status, requestId, message };
}

function mapError(error: { code?: string; message?: string }, requestId: string): StudentReceiptActionState {
  const message = typeof error.message === "string" ? error.message : "";
  if (error.code === "42501") return outcome("forbidden", requestId);
  if (error.code === "22023" || error.code === "23505") {
    if (message === "receipt_not_pending") return outcome("not_pending", requestId);
    if (message === "receipt_obligation_required") return outcome("obligation_required", requestId);
    if (message === "case_agreement_exceeds_balance") return outcome("invalid", requestId, "Сумма больше остатка по платежу.");
    if (message === "case_agreement_invalid") return outcome("invalid", requestId, "Проверьте платёж: валюта чека должна совпадать с валютой платежа.");
    if (message === "receipt_invalid_date") return outcome("invalid", requestId, "Проверьте дату оплаты.");
    return /request|replay|idempot/i.test(message) ? outcome("request_conflict", requestId) : outcome("invalid", requestId);
  }
  return outcome("unavailable", requestId);
}

export async function acceptStudentReceipt(
  actor: PlatformActor,
  requestId: string,
  args: Readonly<{ receiptId: string; obligationId: string | null; amountMinor: string; currency: string; paidOn: string; newDueLabel?: string | null }>,
): Promise<StudentReceiptActionState> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("accept_student_payment_receipt_v1", {
    p_organization_id: actor.organizationId,
    p_receipt_id: args.receiptId,
    p_payment_obligation_id: args.obligationId,
    p_amount_minor: args.amountMinor,
    p_currency: args.currency,
    p_paid_on: args.paidOn,
    p_request_id: requestId,
    p_new_due_label: args.newDueLabel ?? null,
  });
  if (error) return mapError(error, requestId);
  const row = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  return row && row.organization_id === actor.organizationId && row.status === "accepted" ? outcome("saved", requestId) : outcome("unavailable", requestId);
}

export async function rejectStudentReceipt(
  actor: PlatformActor,
  requestId: string,
  args: Readonly<{ receiptId: string; reason: string }>,
): Promise<StudentReceiptActionState> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("reject_student_payment_receipt_v1", {
    p_organization_id: actor.organizationId,
    p_receipt_id: args.receiptId,
    p_reason: args.reason,
    p_request_id: requestId,
  });
  if (error) return mapError(error, requestId);
  const row = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  return row && row.organization_id === actor.organizationId && row.status === "rejected" ? outcome("saved", requestId) : outcome("unavailable", requestId);
}
