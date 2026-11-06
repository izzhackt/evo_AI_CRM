import "server-only";

import { staffCanFinanceTabHint } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { parseStudentDebts, type StudentDebtsRead } from "../student-debts-contract.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * «Долги студентов» (миграция 332): чтение закрыто так же, как «Финансовый отчёт» — системный Admin или держатель
 * `finance.read.full` на ВСЮ организацию; решает функция базы, а здесь стоит дешёвый отказ до обращения к ней (подсказка роли) и
 * строгий разбор ответа. Просмотр роли отказан. Таблицы страница напрямую не читает и сервисного ключа не использует.
 */
export async function readStudentDebts(actor: ActivePlatformActor): Promise<StudentDebtsRead> {
  if (!staffCanFinanceTabHint(actor)) return { status: "denied" };
  try {
    const { data, error } = await (await createSupabaseServerClient())
      .schema("platform").rpc("student_debts_v1", { p_organization_id: actor.organizationId });
    if (error) return error.code === "42501" ? { status: "denied" } : { status: "unavailable" };
    return { status: "available", debts: parseStudentDebts(data, actor.organizationId) };
  } catch {
    return { status: "unavailable" };
  }
}
