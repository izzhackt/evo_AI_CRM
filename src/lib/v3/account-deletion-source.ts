import "server-only";

import type { ActivePlatformActor } from "../platform-auth";
import { isStaffPreview } from "../platform-access";
import { createSupabaseServerClient } from "../supabase/server";
import {
  parseAccountDeletionDetail,
  parseAccountDeletionQueue,
  type AccountDeletionDetail,
  type AccountDeletionQueueRow,
} from "../account-deletion-contract";

export type AccountDeletionQueueRead =
  | Readonly<{ status: "ready"; rows: readonly AccountDeletionQueueRow[] }>
  | Readonly<{ status: "forbidden" | "unavailable" }>;

export type AccountDeletionDetailRead =
  | Readonly<{ status: "ready"; detail: AccountDeletionDetail }>
  | Readonly<{ status: "forbidden" | "unavailable" | "not_found" }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** «Запросы на удаление» — право account.deletion.process (системный Admin). */
export async function readAccountDeletionQueue(actor: ActivePlatformActor): Promise<AccountDeletionQueueRead> {
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) return { status: "forbidden" };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("staff_account_deletion_queue_v1");
    if (error) return { status: error.code === "42501" ? "forbidden" : "unavailable" };
    const rows = parseAccountDeletionQueue(data);
    return rows ? { status: "ready", rows } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function readAccountDeletionDetail(
  actor: ActivePlatformActor,
  id: string,
): Promise<AccountDeletionDetailRead> {
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) return { status: "forbidden" };
  if (!UUID.test(id)) return { status: "not_found" };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.schema("platform").rpc("staff_account_deletion_detail_v1", { p_id: id });
    if (error) {
      return { status: error.message === "account_deletion_not_found" ? "not_found"
        : error.code === "42501" ? "forbidden" : "unavailable" };
    }
    const detail = parseAccountDeletionDetail(data);
    return detail ? { status: "ready", detail } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
