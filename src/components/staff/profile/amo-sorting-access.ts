import { isStaffPreview, staffCan, staffHasPermission } from "../../../lib/platform-access.ts";
import type { ActivePlatformActor } from "../../../lib/platform-auth.ts";

/**
 * Показывать ли кнопки «Принять» в разборе файлов из amoCRM: те же права, что у действий на сервере (перенос в пункт -
 * document.manage, одобрение - documents.write), не в просмотре роли и не в закрытом деле. Это подсказка показа: решает база.
 */
export function canSortDocuments(actor: ActivePlatformActor, uploadAllowed: boolean): boolean {
  return uploadAllowed && !isStaffPreview(actor) && staffHasPermission(actor, "document.manage") && staffCan(actor, "documents.write");
}
