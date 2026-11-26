// Неоконченные отправки комплекта программы («Отправить комплект в EVO»), которые переживают закрытие приложения. Формат
// ключа и записи тот же, что у веба (`application-packages-pending.ts`): `evo.application-packages.v1:<организация>:<участник>:
// <дело>:<программа>:submit:<ревизия требований>`. Запись комплекта несёт весь состав (до 100 файлов), поэтому предел размера больше.
import {
  parseApplicationPackageSubmitIntent,
  type ApplicationPackageSubmitIntent,
} from "@web/lib/portal/application-packages";

import { createPendingStore } from "@/features/preparations/pending-store";

export type PackageOperation = "submit";

/** Предел размера записи как у веба: больше - испорчена. */
const MAX_LENGTH = 262144;

export const packagesPending = createPendingStore<PackageOperation, ApplicationPackageSubmitIntent>({
  name: "evo.application-packages.v1",
  operations: ["submit"],
  maxLength: MAX_LENGTH,
  // Цель записи отправки - ревизия требований, по которой собран состав.
  parse: (scope, _operation, target, value) => {
    const intent = parseApplicationPackageSubmitIntent(value);
    return intent && intent.studentCaseId === scope.studentCaseId && intent.applicationId === scope.applicationId && intent.requirementsRevisionId === target ? intent : null;
  },
});
