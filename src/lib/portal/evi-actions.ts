"use server";

import { getLocale } from "../i18n";
import { createSupabaseServerClient } from "../supabase/server";
import { requireStudentPortalActor } from "../student-portal-guards";
import { runEviTurn } from "./evi-core";
import type { EviActionResult } from "./evi.ts";

/**
 * Следующая реплика Эви (вкладка «Подбор с Эви» в «Профессиях») для веба: ученик кабинета определяется по сессии
 * (cookie), дальше всё делает общее ядро `runEviTurn` — то же, что у мобильного маршрута `/api/portal/mobile/evi`.
 */
export async function askEviAction(history: unknown): Promise<EviActionResult> {
  const actor = await requireStudentPortalActor();
  const [client, locale] = await Promise.all([createSupabaseServerClient(), getLocale()]);
  return runEviTurn({ history, actor, client, locale });
}
