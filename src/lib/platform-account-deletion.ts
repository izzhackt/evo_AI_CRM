import "server-only";

import type { ActivePlatformActor } from "./platform-auth.ts";
import { isStaffPreview } from "./platform-access.ts";
import { parseAccountDeletionQueue } from "./account-deletion-contract.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Есть ли ОТКРЫТЫЙ запрос удаления по делу: «запросил удаление аккаунта» в
 * шапке дела. С миграции 279 читается очередь
 * `staff_account_deletion_queue_v1` (право account.deletion.process, у
 * системного Admin): прежняя 196 не знает статусов «в обработке» и
 * «выполнено». Любой отказ или чужая форма — честное «нет бейджа», не падение
 * карточки.
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
      .rpc("staff_account_deletion_queue_v1");
    if (response.error) return false;
    const rows = parseAccountDeletionQueue(response.data);
    if (!rows) return false;
    return rows.some(
      (row) => row.status !== "completed" && row.studentCaseId === studentCaseId,
    );
  } catch {
    return false;
  }
}
