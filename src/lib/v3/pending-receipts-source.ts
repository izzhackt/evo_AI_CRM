import "server-only";
import { parsePendingReceipts, type PendingReceipt } from "../platform-pending-receipts-contract";
import { parseSalesUuid } from "../platform-sales-register-contract";
import { createSupabaseServerClient } from "../supabase/server";

export type PendingReceiptsRead = Readonly<{ status: "ok"; receipts: readonly PendingReceipt[] }> | Readonly<{ status: "unavailable" }>;

/** Чеки из разбора документов, ждущие привязки к оплате (349). Сбой чтения - честное «недоступно», не пустой список. */
export async function readPendingReceipts(organizationId: string, studentCaseId: string): Promise<PendingReceiptsRead> {
  const caseId = parseSalesUuid(studentCaseId);
  if (!caseId) return { status: "unavailable" };
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("staff_case_pending_receipts_v1", { p_student_case_id: caseId });
  if (error) return { status: "unavailable" };
  try {
    return { status: "ok", receipts: parsePendingReceipts(data, organizationId, caseId) };
  } catch {
    return { status: "unavailable" };
  }
}
