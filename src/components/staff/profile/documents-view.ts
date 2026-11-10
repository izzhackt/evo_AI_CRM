/**
 * Вкладка «Документы» дела: чистая логика строки без React. Список един —
 * без фильтра по состоянию (убран 10.11: «Все» и так показывает всё, а числа
 * дублировали строку «N из M принято»).
 */
import type { PlatformDocumentSlotStatus } from "../../../lib/platform-private-documents.ts";
import { documentSlotStatus } from "../../../lib/v3/wording.ts";
import type { StatusChipTone } from "../blocks/StatusChip.tsx";

/**
 * Одно слово состояния строки (тот же словарь, что у кабинета студента) и
 * тон чипа: «На проверке» — очередь сотрудника, «Нужно исправить» и
 * «Отклонён» — очередь студента (предупреждение, не красный), «Принят» — готово.
 */
export function documentStatusChip(
  status: PlatformDocumentSlotStatus,
): Readonly<{ label: string; tone: StatusChipTone }> | null {
  const label = documentSlotStatus(status);
  if (!label) return null;
  const tone: StatusChipTone = status === "approved" ? "ok"
    : status === "submitted" ? "info"
      : status === "correction_required" || status === "rejected" ? "warn"
        : "neutral";
  return Object.freeze({ label, tone });
}
