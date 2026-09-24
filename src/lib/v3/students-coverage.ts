import type { StudentsCoverage } from "@/components/v3/profile/students-facets";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth";
import { parseCoverageUuid, type CoverageWorkspace } from "../platform-case-coverage-contract.ts";

type Query = Readonly<Record<string, string | readonly string[] | undefined>>;

export type CoverageWorkspaceReader = (
  actor: ActivePlatformActor,
  selection: Readonly<{ curatorId?: string; caseId?: string; afterCaseId?: string }>,
) => Promise<CoverageWorkspace>;

/**
 * Нагрузка и замещение кураторов для «Студентов» — то же чтение и те же
 * параметры `coverage_*`, что у прежней панели. Куратор раздела — явный
 * `coverage_curator`, иначе куратор, выбранный фасетом таблицы. Недоступное
 * или запрещённое чтение не превращается в нулевую нагрузку.
 *
 * Чтение по куратору отказывает целиком (42501 «Curator unavailable»), если
 * выбранный участник больше не куратор: старая закладка или смена роли. Тогда
 * читаем нагрузку без куратора. Если в этом списке его нет — это тот самый
 * отказ: числа фасетов остаются, а раздел замещения честно говорит, что
 * замещать некого. Если он в списке есть, отказ был другим, и раздел остаётся
 * «недоступен», как раньше. Код ошибки сервер наружу не отдаёт, поэтому
 * причину проверяем по тому же условию, что и SQL, — по списку кураторов.
 */
export async function resolveStudentsCoverage(
  actor: ActivePlatformActor,
  query: Query,
  directoryCuratorId: string | undefined,
  read: CoverageWorkspaceReader,
): Promise<StudentsCoverage> {
  if (!staffHasPermission(actor, "case.curator.assign") || isStaffPreview(actor)) return { kind: "hidden" };
  const requested = [query.coverage_curator, query.coverage_case, query.coverage_after];
  const [curatorParam, caseId, afterCaseId] = requested.map((value) => value === undefined ? undefined : parseCoverageUuid(value));
  if ([curatorParam, caseId, afterCaseId].includes(null) || ((caseId || afterCaseId) && !curatorParam)) {
    return { kind: "invalid" };
  }
  const selection = {
    curatorId: curatorParam ?? directoryCuratorId ?? null,
    caseId: caseId ?? null,
    afterCaseId: afterCaseId ?? null,
    explicit: requested.some((value) => value !== undefined),
  };
  try {
    const workspace = await read(actor, {
      curatorId: selection.curatorId ?? undefined,
      caseId: selection.caseId ?? undefined,
      afterCaseId: selection.afterCaseId ?? undefined,
    });
    return { kind: "ready", workspace, ...selection };
  } catch {
    if (!selection.curatorId) return { kind: "unavailable", ...selection };
  }
  try {
    const { curators } = await read(actor, {});
    return curators.some((curator) => curator.id === selection.curatorId)
      ? { kind: "unavailable", ...selection }
      : { kind: "curator_unavailable", curators, ...selection };
  } catch {
    return { kind: "unavailable", ...selection };
  }
}
