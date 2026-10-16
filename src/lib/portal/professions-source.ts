import "server-only";

import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { readStudentAssessmentAttempt, readStudentAssessments } from "../v3/student-assessment-source";
import { readStudentUniversitiesComplete } from "./university-catalog-reader";
import { readStudentUniversities, reviewedUniversityNameForPhotoKey } from "../v3/university-source";
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

const ALL_UNIVERSITIES = { query: "", country: "", level: "", offset: 0 } as const;
/** Потолок длины поиска `student_university_catalog` (148: length ≤ 100). */
const CATALOGUE_QUERY_LIMIT = 100;

/**
 * Связи «куда учиться» -> реальные карточки каталога (план A, 16.10.2026).
 *
 * Сначала точечно: по имени проверенного шаблона для каждого photoKey —
 * одна страница `student_university_catalog` на связь, все параллельно.
 * Совпадение решает строгое сравнение photoKey в ответе базы. Если хоть одна
 * связь не нашлась или поиск не удался, читается весь каталог, как раньше
 * (те же страницы, что у карты, см. readStudentUniversitiesComplete).
 * Ненайденный photoKey или программа — честный текст без ссылки, а не
 * фиктивный переход.
 */
export async function resolveProfessionPrograms(
  actor: ActiveStudentPortalActor,
  refs: readonly ProfessionLinkedProgramRef[],
): Promise<ResolvedProgramRef[]> {
  if (refs.length === 0) return [];
  const queries = new Map<string, string>();
  for (const ref of refs) {
    const name = reviewedUniversityNameForPhotoKey(ref.institution_photo_key);
    if (name && name.length <= CATALOGUE_QUERY_LIMIT) queries.set(ref.institution_photo_key, name);
  }
  if (queries.size === new Set(refs.map((ref) => ref.institution_photo_key)).size) {
    try {
      const pages = await Promise.all([...queries.values()].map((query) =>
        readStudentUniversities(actor, { ...ALL_UNIVERSITIES, query })));
      const resolved = resolveLinkedPrograms(refs, pages.flatMap((page) => page.items));
      if (resolved.every((entry) => entry.institutionId !== null)) return resolved;
    } catch {
      // Точечный поиск не удался — ниже прежнее полное чтение.
    }
  }
  const universities = await readStudentUniversitiesComplete(actor, ALL_UNIVERSITIES);
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
