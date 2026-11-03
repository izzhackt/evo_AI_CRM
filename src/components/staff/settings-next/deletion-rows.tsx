import { StatusBadge } from "@/components/kit";
import type { AccountDeletionQueueRow } from "@/lib/account-deletion-contract";

/** Состояние запроса словом: выполнено / удалено, не завершено, ждёт удаления (слова те же, что у прежнего вида). */
export function deletionStatusBadge(row: Pick<AccountDeletionQueueRow, "status" | "mode">) {
  if (row.status === "completed") return <StatusBadge tone="ok" label={row.mode === "manual" ? "выполнено" : "удалено"} />;
  if (row.status === "processing") return <StatusBadge tone="warn" label="не завершено" />;
  return <StatusBadge label="ждёт удаления" />;
}
