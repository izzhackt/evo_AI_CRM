import "server-only";

import type { ActivePlatformActor } from "./platform-auth.ts";
import { isStaffPreview } from "./platform-access.ts";

/**
 * Staff-чтение запросов удаления аккаунта (PORT-5a, миграция 196).
 * RPC admin-only; здесь — транспорт, строгий разбор и «тихий ноль» для
 * не-admin: бейдж в карточке клиента аддитивен и не должен ронять карточку
 * или показывать ложное отсутствие как ошибку (fail-closed = нет бейджа).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AccountDeletionRequestRow = Readonly<{
  requestId: string;
  membershipId: string;
  studentCaseId: string | null;
  displayName: string;
  status: "requested" | "acknowledged";
  requestedAt: string;
}>;

export function parseAccountDeletionRequests(
  value: unknown,
): readonly AccountDeletionRequestRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: AccountDeletionRequestRow[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.requestId !== "string" || !UUID_PATTERN.test(row.requestId)
      || typeof row.membershipId !== "string" || !UUID_PATTERN.test(row.membershipId)
      || !(row.studentCaseId === null
        || (typeof row.studentCaseId === "string" && UUID_PATTERN.test(row.studentCaseId)))
      || typeof row.displayName !== "string"
      || (row.status !== "requested" && row.status !== "acknowledged")
      || typeof row.requestedAt !== "string"
      || Number.isNaN(Date.parse(row.requestedAt))
    ) return null;
    rows.push({
      requestId: row.requestId,
      membershipId: row.membershipId,
      studentCaseId: row.studentCaseId,
      displayName: row.displayName,
      status: row.status,
      requestedAt: row.requestedAt,
    });
  }
  return rows;
}

/**
 * Есть ли ОТКРЫТЫЙ запрос удаления по делу. Только для admin (RPC 196 —
 * admin-only); любой отказ/дрейф формы — честное «нет бейджа», не падение
 * карточки клиента.
 */
export async function hasOpenAccountDeletionRequestForCase(
  actor: ActivePlatformActor,
  studentCaseId: string,
): Promise<boolean> {
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) return false;
  if (!UUID_PATTERN.test(studentCaseId)) return false;
  try {
    const { createSupabaseServerClient } = await import("./supabase/server");
    const client = await createSupabaseServerClient();
    const response = await client
      .schema("platform")
      .rpc("staff_account_deletion_requests_v1");
    if (response.error) return false;
    const rows = parseAccountDeletionRequests(response.data);
    if (!rows) return false;
    return rows.some(
      (row) => row.status === "requested" && row.studentCaseId === studentCaseId,
    );
  } catch {
    return false;
  }
}
