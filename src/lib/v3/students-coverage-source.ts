import "server-only";

import type { StudentsCoverage } from "@/components/v3/profile/students-facets";

import type { ActivePlatformActor } from "../platform-auth";
import { readCuratorCoverageWorkspace } from "../server/curator-coverage-source";
import { resolveStudentsCoverage } from "./students-coverage.ts";

type Query = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Нагрузка и замещение кураторов для «Студентов» через настоящее чтение
 * `read_curator_coverage_workspace`. Правила выбора куратора и отказа — в
 * `resolveStudentsCoverage` (чистая функция, проверяется без Supabase).
 */
export async function loadStudentsCoverage(
  actor: ActivePlatformActor,
  query: Query,
  directoryCuratorId: string | undefined,
): Promise<StudentsCoverage> {
  return resolveStudentsCoverage(actor, query, directoryCuratorId, readCuratorCoverageWorkspace);
}
