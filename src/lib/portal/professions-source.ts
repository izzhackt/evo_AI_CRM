import "server-only";

import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { readStudentAssessmentAttempt, readStudentAssessments } from "../v3/student-assessment-source";
import { readStudentUniversitiesComplete } from "./university-catalog-reader";
import {
  parseProfessionCard,
  parseProfessionCards,
  resolveLinkedPrograms,
  type ProfessionCard,
  type ProfessionCardSummary,
  type ProfessionLinkedProgramRef,
  type ResolvedProgramRef,
} from "./professions";

/** Серверный транспорт раздела «Профессии» (миграции 198/199). */
export class ProfessionSourceError extends Error {
  constructor() {
    super("Professions are unavailable.");
    this.name = "ProfessionSourceError";
  }
}

async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = await createSupabaseServerClient();
  const response = await client.schema("platform").rpc(name, args);
  if (response.error) throw new ProfessionSourceError();
  return response.data;
}

export async function readProfessionCards(): Promise<ProfessionCardSummary[]> {
  try {
    return parseProfessionCards(await rpc("profession_cards_v1"));
  } catch {
    throw new ProfessionSourceError();
  }
}

export async function readProfessionCard(cardId: string): Promise<ProfessionCard> {
  try {
    return parseProfessionCard(await rpc("profession_card_v1", { p_card_id: cardId }));
  } catch {
    throw new ProfessionSourceError();
  }
}

/**
 * Связи «куда учиться» -> реальные карточки каталога. Каталог читается
 * существующим student-RPC (те же страницы, что и карта, см. cost-комментарий
 * в readStudentUniversitiesComplete); ненайденный photoKey или программа —
 * честный текст без ссылки, а не фиктивный переход.
 */
export async function resolveProfessionPrograms(
  actor: ActiveStudentPortalActor,
  refs: readonly ProfessionLinkedProgramRef[],
): Promise<ResolvedProgramRef[]> {
  const universities = await readStudentUniversitiesComplete(actor, {
    query: "",
    country: "",
    level: "",
    offset: 0,
  });
  return resolveLinkedPrograms(refs, universities);
}

/**
 * topScales СОБСТВЕННОГО завершённого orvis92 через СУЩЕСТВУЮЩИЙ приватный
 * student-RPC в сессии ученика. Нет завершённой попытки или чтение не
 * удалось — честный null (отметка «созвучно» просто не показывается).
 */
export async function readOwnOrvisTopScales(): Promise<string[] | null> {
  try {
    const catalog = await readStudentAssessments();
    const orvis = catalog.instruments.find((item) => item.instrumentKey === "orvis92");
    if (!orvis?.latestCompletedAttemptId) return null;
    const attempt = await readStudentAssessmentAttempt(orvis.latestCompletedAttemptId);
    const topScales = attempt.result && "orvis" in attempt.result
      ? attempt.result.orvis?.topScales ?? null
      : null;
    return topScales && topScales.length > 0 ? [...topScales] : null;
  } catch {
    return null;
  }
}
