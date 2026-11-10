"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformStaffActor } from "./platform-guards";
import { isStaffPreview } from "./platform-access.ts";
import { decimalToMinor, financeLocalDate } from "./platform-finance-entry-contract";
import type { StudentReceiptActionState } from "./platform-student-receipts-contract";
import { parseSalesUuid } from "./platform-sales-register-contract";
import { exactActionStringFields } from "./server/action-form-fields";
import { acceptStudentReceipt, rejectStudentReceipt } from "./v3/student-receipts-source";

// Тот же приём useActionState + requestId, что у recordCasePaymentAction (platform-case-agreement-actions.ts): повтор после сбоя шлёт тот
// же request_id, а решение принимает база (права, остаток, валюта, одно решение на чек).

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function fail(previous: StudentReceiptActionState, requestId: string | null, status: StudentReceiptActionState["status"]): StudentReceiptActionState {
  return { status, requestId: requestId ?? previous.requestId, message: null };
}

export async function acceptStudentReceiptAction(previous: StudentReceiptActionState, form: FormData): Promise<StudentReceiptActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "receipt_id", "payment_obligation_id", "amount", "currency", "at"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  if (!fields || !requestId) return fail(previous, null, "invalid");
  if (isStaffPreview(actor)) return fail(previous, requestId, "forbidden");
  const text = (key: string) => fields.get(key)!.trim();
  const receiptId = parseSalesUuid(text("receipt_id"));
  const obligationId = text("payment_obligation_id") ? parseSalesUuid(text("payment_obligation_id")) : null;
  const amount = decimalToMinor(text("amount"));
  const currency = text("currency").toUpperCase();
  const paidOn = financeLocalDate(`${text("at")}T00:00`);
  if (!receiptId || (text("payment_obligation_id") && !obligationId) || !amount || !/^[A-Z]{3}$/.test(currency) || !paidOn
    || [...fields.values()].some((value) => value.length > 200 || CONTROL.test(value))) {
    return fail(previous, requestId, "invalid");
  }
  try {
    const state = await acceptStudentReceipt(actor, requestId, { receiptId, obligationId, amountMinor: amount, currency, paidOn });
    if (state.status === "saved") {
      revalidatePath("/profile");
      revalidatePath("/finance");
      revalidatePath("/main");
    }
    return state;
  } catch {
    return fail(previous, requestId, "unavailable");
  }
}

export async function rejectStudentReceiptAction(previous: StudentReceiptActionState, form: FormData): Promise<StudentReceiptActionState> {
  const actor = await requirePlatformStaffActor();
  const fields = exactActionStringFields(form, ["request_id", "receipt_id", "reason"]);
  const requestId = fields && parseSalesUuid(fields.get("request_id"));
  if (!fields || !requestId) return fail(previous, null, "invalid");
  if (isStaffPreview(actor)) return fail(previous, requestId, "forbidden");
  const receiptId = parseSalesUuid(fields.get("receipt_id")!.trim());
  const reason = fields.get("reason")!.trim();
  if (!receiptId || reason === "" || reason.length > 1000 || CONTROL.test(reason.replace(/\n/g, " "))) return fail(previous, requestId, "invalid");
  try {
    const state = await rejectStudentReceipt(actor, requestId, { receiptId, reason });
    if (state.status === "saved") {
      revalidatePath("/profile");
      revalidatePath("/finance");
      revalidatePath("/main");
    }
    return state;
  } catch {
    return fail(previous, requestId, "unavailable");
  }
}
