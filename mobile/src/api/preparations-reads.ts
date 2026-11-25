// Чтения экрана «Требования программы» через RPC схемы `platform`. Транспорт приходит аргументом, поэтому слой не знает
// про Supabase и проверяется без сети. Веб читает то же: страница `portal/preparations/[applicationId]` берёт
// `student_catalog_preparations_v1` (общая `readPreparations`, она уже есть в `portal-reads.ts`) и
// `application_package_readiness_v1` (требования v2, состояние документов и готовность комплекта одним ответом).
// Форму ответа проверяют строгие разборщики веба целиком: чужая форма - ошибка данных, а не выдуманный пустой список.
import {
  parseApplicationDocumentTarget,
  type ApplicationDocumentSelection,
} from "@web/lib/portal/application-documents";
import {
  parseApplicationPackageReadiness,
  parseApplicationPackageSelections,
  type ApplicationPackageReadiness,
  type ApplicationPackageSelection,
} from "@web/lib/portal/application-packages";

import { PortalDecodeError } from "@/domain/portal-source";
import { rpcRead, type RpcTransport } from "@/lib/rpc";

function sameSelection(a: ApplicationDocumentSelection, b: ApplicationDocumentSelection): boolean {
  if (a.kind !== b.kind || a.documentVersionId !== b.documentVersionId) return false;
  return a.kind === "program_upload" && b.kind === "program_upload" ? a.uploadContextId === b.uploadContextId : true;
}

/**
 * Ответ обязан повторить посланный выбор поштучно и по порядку: иначе это ответ на другой вопрос
 * (веб: `readiness` в `application-packages-actions.ts`).
 */
export function readinessEchoesSelections(
  readiness: Pick<ApplicationPackageReadiness, "selections">,
  selections: readonly ApplicationPackageSelection[],
): boolean {
  return (
    readiness.selections.length === selections.length &&
    readiness.selections.every((item, index) => {
      const expected = selections[index];
      return (
        expected !== undefined &&
        item.requirementItemId === expected.requirementItemId &&
        item.expectedPreviousSubmissionId === expected.expectedPreviousSubmissionId &&
        sameSelection(item.selection, expected.selection)
      );
    })
  );
}

/**
 * Требования программы, состояние документов и готовность комплекта: `application_package_readiness_v1`.
 * `selections` пуст для обычного чтения экрана и непуст для «Проверить состав» комплекта (G37). POST, как в вебе:
 * выбор уходит JSON-телом, а не строкой запроса.
 */
export async function readApplicationReadiness(
  transport: RpcTransport,
  studentCaseId: string,
  applicationId: string,
  selections: readonly ApplicationPackageSelection[] = [],
): Promise<ApplicationPackageReadiness> {
  const target = parseApplicationDocumentTarget({ studentCaseId, applicationId });
  const picked = parseApplicationPackageSelections(selections);
  if (!target || !picked) throw new PortalDecodeError();
  const data = await rpcRead(transport, "application_package_readiness_v1", {
    p_student_case_id: target.studentCaseId,
    p_application_id: target.applicationId,
    p_selections: picked,
  });
  const readiness = parseApplicationPackageReadiness(data, target);
  if (!readiness || !readinessEchoesSelections(readiness, picked)) throw new PortalDecodeError();
  return readiness;
}
