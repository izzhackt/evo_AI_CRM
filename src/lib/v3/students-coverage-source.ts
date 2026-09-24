import "server-only";

import type { StudentsCoverage } from "@/components/v3/profile/students-facets";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth";
import { parseCoverageUuid } from "../platform-case-coverage-contract";
import { readCuratorCoverageWorkspace } from "../server/curator-coverage-source";

type Query = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Нагрузка и замещение кураторов для «Студентов» — то же чтение и те же
 * параметры `coverage_*`, что у прежней панели. Куратор раздела — явный
 * `coverage_curator`, иначе куратор, выбранный фасетом таблицы. Недоступное
 * или запрещённое чтение не превращается в нулевую нагрузку.
 */
export async function loadStudentsCoverage(
  actor: ActivePlatformActor,
  query: Query,
  directoryCuratorId: string | undefined,
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
    const workspace = await readCuratorCoverageWorkspace(actor, {
      curatorId: selection.curatorId ?? undefined,
      caseId: selection.caseId ?? undefined,
      afterCaseId: selection.afterCaseId ?? undefined,
    });
    return { kind: "ready", workspace, ...selection };
  } catch {
    return { kind: "unavailable", ...selection };
  }
}
