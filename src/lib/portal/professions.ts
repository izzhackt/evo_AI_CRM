import type { PublishedUniversity } from "../platform-university-catalog";

/**
 * Контракт раздела «Профессии» (PORT-4c поверх profession_cards 198/199):
 * строгие парсеры проекций RPC, чистый резолвер связей с каталогом и
 * клиентская отметка «созвучно интересам».
 */

export const ORVIS_SCALE_IDS = [
  "leadership", "organization", "altruism", "creativity",
  "analysis", "production", "adventure", "erudition",
] as const;

export type OrvisScaleId = (typeof ORVIS_SCALE_IDS)[number];

export function isOrvisScaleId(value: unknown): value is OrvisScaleId {
  return typeof value === "string" && (ORVIS_SCALE_IDS as readonly string[]).includes(value);
}

export class ProfessionParseError extends Error {
  constructor() {
    super("Profession payload has an unexpected shape.");
    this.name = "ProfessionParseError";
  }
}

const fail = (): never => {
  throw new ProfessionParseError();
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
}
function text(value: unknown, max = 12000): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    && !/[\x00--]/u.test(value)
    ? value
    : fail();
}
function textList(value: unknown, max = 12): string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= max
    ? value.map((item) => text(item, 2000))
    : fail();
}
function uuid(value: unknown): string {
  return typeof value === "string" && UUID.test(value) ? value : fail();
}
function optionalText(value: unknown, max: number): string | null {
  return value === undefined || value === null ? null : text(value, max);
}
function scales(value: unknown): OrvisScaleId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return fail();
  return value.map((item) => (isOrvisScaleId(item) ? item : fail()));
}

export type ProfessionCardSummary = {
  cardId: string;
  cardKey: string;
  version: string;
  titleRu: string;
  titleKy: string;
  orvisScales: OrvisScaleId[];
  /** Строка о работе (контент 1.1.0, миграция 359); у карточек 1.0.0 — null. */
  summaryRu: string | null;
  summaryKy: string | null;
};

export type ProfessionLinkedProgramRef = {
  institution_photo_key: string;
  program_hint: string;
};

export type ProfessionCardBody = {
  id: string;
  title_ru: string;
  title_ky: string;
  orvis_scales: OrvisScaleId[];
  day_in_work_ru: string;
  day_in_work_ky: string;
  environment_ru: string;
  environment_ky: string;
  skills_ru: string[];
  skills_ky: string[];
  interesting_ru: string[];
  interesting_ky: string[];
  hard_ru: string[];
  hard_ky: string[];
  trial_task_ru: string;
  trial_task_ky: string;
  study_directions_ru: string[];
  study_directions_ky: string[];
  linked_program_refs: ProfessionLinkedProgramRef[];
  sources: string[];
  /** Контент 1.1.0 (миграция 359); у карточек 1.0.0 — null. */
  summary_ru: string | null;
  summary_ky: string | null;
  school_subjects_ru: string[] | null;
  school_subjects_ky: string[] | null;
};

export type ProfessionCard = {
  cardId: string;
  cardKey: string;
  version: string;
  body: ProfessionCardBody;
};

export function parseProfessionCards(value: unknown): ProfessionCardSummary[] {
  const row = record(value);
  const cards = row.cards;
  if (!Array.isArray(cards) || cards.length > 100) return fail();
  return cards.map((item) => {
    const card = record(item);
    return {
      cardId: uuid(card.cardId),
      cardKey: text(card.cardKey, 120),
      version: text(card.version, 80),
      titleRu: text(card.titleRu, 300),
      titleKy: text(card.titleKy, 300),
      orvisScales: scales(card.orvisScales),
      summaryRu: optionalText(card.summaryRu, 300),
      summaryKy: optionalText(card.summaryKy, 300),
    };
  });
}

export function parseProfessionCard(value: unknown): ProfessionCard {
  const row = record(value);
  const body = record(row.body);
  const pairList = (key: string) => textList(body[key]);
  const parsedBody: ProfessionCardBody = {
    id: text(body.id, 120),
    title_ru: text(body.title_ru, 300),
    title_ky: text(body.title_ky, 300),
    orvis_scales: scales(body.orvis_scales),
    day_in_work_ru: text(body.day_in_work_ru),
    day_in_work_ky: text(body.day_in_work_ky),
    environment_ru: text(body.environment_ru),
    environment_ky: text(body.environment_ky),
    skills_ru: pairList("skills_ru"),
    skills_ky: pairList("skills_ky"),
    interesting_ru: pairList("interesting_ru"),
    interesting_ky: pairList("interesting_ky"),
    hard_ru: pairList("hard_ru"),
    hard_ky: pairList("hard_ky"),
    trial_task_ru: text(body.trial_task_ru),
    trial_task_ky: text(body.trial_task_ky),
    study_directions_ru: pairList("study_directions_ru"),
    study_directions_ky: pairList("study_directions_ky"),
    linked_program_refs: Array.isArray(body.linked_program_refs)
      && body.linked_program_refs.length >= 1 && body.linked_program_refs.length <= 8
      ? body.linked_program_refs.map((item) => {
        const ref = record(item);
        return {
          institution_photo_key: text(ref.institution_photo_key, 200),
          program_hint: text(ref.program_hint, 300),
        };
      })
      : fail(),
    sources: Array.isArray(body.sources) && body.sources.length >= 1 && body.sources.length <= 4
      ? body.sources.map((item) => {
        const source = text(item, 2000);
        return source.startsWith("https://") ? source : fail();
      })
      : fail(),
    summary_ru: optionalText(body.summary_ru, 300),
    summary_ky: optionalText(body.summary_ky, 300),
    school_subjects_ru: body.school_subjects_ru === undefined ? null : pairList("school_subjects_ru"),
    school_subjects_ky: body.school_subjects_ky === undefined ? null : pairList("school_subjects_ky"),
  };
  if (parsedBody.skills_ru.length !== parsedBody.skills_ky.length) return fail();
  if ((parsedBody.school_subjects_ru === null) !== (parsedBody.school_subjects_ky === null)
    || (parsedBody.school_subjects_ru?.length ?? 0) !== (parsedBody.school_subjects_ky?.length ?? 0)) return fail();
  return {
    cardId: uuid(row.cardId),
    cardKey: text(row.cardKey, 120),
    version: text(row.version, 80),
    body: parsedBody,
  };
}

/**
 * Резолюция связи с каталогом: institution_photo_key -> content.photoKey,
 * program_hint -> точное название программы. Ненайденное честно остаётся
 * без ссылки (notes: «деградировать в „программа не найдена“, а не падать»).
 */
export type ResolvedProgramRef = {
  ref: ProfessionLinkedProgramRef;
  institutionId: string | null;
  institutionName: string | null;
  programFound: boolean;
};

export function resolveLinkedPrograms(
  refs: readonly ProfessionLinkedProgramRef[],
  universities: readonly PublishedUniversity[],
): ResolvedProgramRef[] {
  return refs.map((ref) => {
    const university = universities.find(
      (item) => item.content.photoKey === ref.institution_photo_key,
    );
    if (!university) {
      return { ref, institutionId: null, institutionName: null, programFound: false };
    }
    return {
      ref,
      institutionId: university.id,
      institutionName: university.content.name,
      programFound: university.content.programs.some(
        (program) => program.title === ref.program_hint,
      ),
    };
  });
}

/**
 * «Созвучно твоим интересам»: пересечение шкал карточки с topScales
 * СОБСТВЕННОГО завершённого orvis92. Считается на клиенте; серверной связки
 * результатов теста с профессиями нет (план §6).
 */
export function professionResonates(
  cardScales: readonly string[],
  topScales: readonly string[] | null,
): boolean {
  if (!topScales || topScales.length === 0) return false;
  return cardScales.some((scale) => topScales.includes(scale));
}
