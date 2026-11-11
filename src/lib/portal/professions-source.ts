import "server-only";

import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { createSupabaseServerClient } from "../supabase/server";
import { readStudentAssessmentAttempt, readStudentAssessments } from "../v3/student-assessment-source";
import { UniversityNotFoundError, readStudentUniversityDetail, readStudentUniversityIndex } from "./university-index-source";
import type { StudentUniversityDetail } from "./university-index";
import {
  programNextStartMonth,
  programTuition,
  type OrvisProfile,
  type OrvisState,
  type ProfessionProgramRow,
} from "./profession-guide";
import {
  isOrvisScaleId,
  parseProfessionCard,
  parseProfessionCards,
  type ProfessionCard,
  type ProfessionCardSummary,
  type ProfessionLinkedProgramRef,
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
 * Связи «куда учиться» -> вузы каталога с ценой, набором и избранным
 * (разбор владельца 10.11.2026, «Вести к вузам»). photoKey ищется в индексе
 * шести стран (одна выдача, повтор из кэша по версии), страница вуза
 * читается одним вызовом на вуз, все параллельно: в ней программы с
 * наборами, опубликованная стоимость и своё избранное. Ненайденный вуз или
 * программа — честная строка без ссылки, цены и даты, а не выдумка.
 */
export async function readProfessionPrograms(
  actor: ActiveStudentPortalActor,
  refs: readonly ProfessionLinkedProgramRef[],
  now: Date,
): Promise<ProfessionProgramRow[]> {
  if (refs.length === 0) return [];
  const index = await readStudentUniversityIndex(actor);
  const wanted = new Set(refs.map((ref) => ref.institution_photo_key));
  const ids = [...new Set(index.universities
    .filter((item) => item.photoKey !== null && wanted.has(item.photoKey))
    .map((item) => item.id))];
  const details = (await Promise.all(ids.map((id) => readStudentUniversityDetail(id).then(
    (detail): StudentUniversityDetail | null => detail,
    (error: unknown) => {
      // Вуз сняли с публикации между двумя чтениями: связь без ссылки.
      if (error instanceof UniversityNotFoundError) return null;
      throw error;
    },
  )))).filter((detail): detail is StudentUniversityDetail => detail !== null);
  return refs.map((ref) => {
    const detail = details.find((item) => item.university.content.photoKey === ref.institution_photo_key);
    if (!detail) {
      return {
        ref, institutionId: null, institutionName: null, countryName: null, programFound: false,
        favored: false, tuition: null, nextStartMonth: null,
      };
    }
    const program = detail.university.content.programs.find((item) => item.title === ref.program_hint) ?? null;
    return {
      ref,
      institutionId: detail.university.id,
      institutionName: detail.university.content.name,
      countryName: detail.country.name,
      programFound: program !== null,
      favored: detail.favored,
      tuition: programTuition(detail.costs?.rows ?? [], program),
      nextStartMonth: program ? programNextStartMonth(program, now) : null,
    };
  });
}

/**
 * Состояние СОБСТВЕННОГО orvis92 через СУЩЕСТВУЮЩИЕ приватные student-RPC в
 * сессии ученика. Инструмента нет или чтение не удалось — честный null:
 * блок теста ведёт в раздел без прогресса, «Подходят вам» не показывается.
 */
export async function readOwnOrvisState(): Promise<OrvisState | null> {
  try {
    const catalog = await readStudentAssessments();
    const orvis = catalog.instruments.find((item) => item.instrumentKey === "orvis92");
    if (!orvis) return null;
    const draft = orvis.draftAttemptId
      ? catalog.attempts.find((attempt) => attempt.attemptId === orvis.draftAttemptId) ?? null
      : null;
    let profile: OrvisProfile | null = null;
    if (orvis.latestCompletedAttemptId) {
      try {
        const attempt = await readStudentAssessmentAttempt(orvis.latestCompletedAttemptId);
        const result = attempt.result && "orvis" in attempt.result ? attempt.result.orvis ?? null : null;
        if (result && result.scales.length > 0) {
          profile = {
            means: Object.fromEntries(result.scales.map((item) => [item.scale, item.mean])),
            topScales: result.topScales.filter(isOrvisScaleId),
          };
        }
      } catch {
        profile = null;
      }
    }
    return {
      questionCount: orvis.questionCount,
      draftAnswered: draft ? draft.answeredCount : null,
      completed: orvis.latestCompletedAttemptId !== null,
      profile,
    };
  } catch {
    return null;
  }
}
