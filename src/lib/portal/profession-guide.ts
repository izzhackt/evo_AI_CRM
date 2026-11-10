import type { UniversityLevel, UniversityProgram } from "../platform-university-catalog.ts";
import { ORVIS_SCALE_IDS, type OrvisScaleId, type ProfessionCardSummary, type ProfessionLinkedProgramRef } from "./professions.ts";
import type { CostRow, LocalizedText } from "./university-index.ts";

/**
 * Чистая логика раздела «Профессии» по разбору владельца 10.11.2026
 * (docs/design/v3/product.md): «Подходят вам» с процентом и причиной,
 * группы по интересам, поиск, цена и ближайший набор программ каталога.
 * Файл клиент-безопасный; ничего не выдумывает — нет данных, нет значения.
 */

/** Профиль собственного завершённого orvis92: среднее 1..5 по каждой шкале. */
export type OrvisProfile = Readonly<{
  means: Readonly<Partial<Record<OrvisScaleId, number>>>;
  topScales: readonly OrvisScaleId[];
}>;

export type ProfessionMatch = Readonly<{
  card: ProfessionCardSummary;
  /** 0..100: насколько высоки интересы студента по шкалам профессии. */
  percent: number;
  /** Шкалы профессии, где интерес студента высокий (для «почему»), 1..2. */
  reasons: readonly OrvisScaleId[];
}>;

/**
 * Совпадение = среднее по шкалам профессии от (mean − 1) / 4: ответ «полностью
 * согласен» по всем утверждениям шкалы даёт 100 %, «совсем не согласен» — 0 %.
 * Шкалы без ответа в профиле нет — совпадения нет (null), не ноль.
 */
export function professionMatch(card: ProfessionCardSummary, profile: OrvisProfile): ProfessionMatch | null {
  const means = card.orvisScales.map((scale) => profile.means[scale]);
  if (means.some((mean) => mean === undefined)) return null;
  const percent = Math.round(
    (means as number[]).reduce((sum, mean) => sum + (mean - 1) / 4, 0) / means.length * 100,
  );
  const byInterest = [...card.orvisScales].sort(
    (a, b) => (profile.means[b] ?? 0) - (profile.means[a] ?? 0),
  );
  const top = byInterest.filter((scale) => profile.topScales.includes(scale));
  return { card, percent, reasons: (top.length > 0 ? top : byInterest.slice(0, 1)).slice(0, 2) };
}

/** Лучшие совпадения: процент по убыванию, при равенстве — по названию. */
export function topProfessionMatches(
  cards: readonly ProfessionCardSummary[],
  profile: OrvisProfile,
  limit = 3,
): ProfessionMatch[] {
  return cards
    .map((card) => professionMatch(card, profile))
    .filter((match): match is ProfessionMatch => match !== null)
    .sort((a, b) => b.percent - a.percent || a.card.titleRu.localeCompare(b.card.titleRu, "ru"))
    .slice(0, limit);
}

export type ProfessionGroup = Readonly<{ scale: OrvisScaleId; cards: readonly ProfessionCardSummary[] }>;

/** Группы по основной (первой) шкале карточки, в порядке шкал ORVIS. */
export function groupProfessionsByScale(cards: readonly ProfessionCardSummary[]): ProfessionGroup[] {
  return ORVIS_SCALE_IDS
    .map((scale) => ({ scale, cards: cards.filter((card) => card.orvisScales[0] === scale) }))
    .filter((group) => group.cards.length > 0);
}

function searchable(value: string): string {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replaceAll(/\s+/gu, " ").trim();
}

/** Поиск по названию (RU и KY) и строке о работе выбранного языка. */
export function searchProfessions(
  cards: readonly ProfessionCardSummary[],
  query: string,
  locale: "ru" | "ky",
): ProfessionCardSummary[] {
  const needle = searchable(query);
  if (needle === "") return [...cards];
  return cards.filter((card) => [card.titleRu, card.titleKy, locale === "ky" ? card.summaryKy : card.summaryRu]
    .some((value) => value !== null && searchable(value).includes(needle)));
}

/** Сумма за год: в валюте вуза и, если сервер дал, ориентир в USD. */
export type ProgramTuition = Readonly<{
  currency: string;
  exponent: number;
  minMinor: number;
  maxMinor: number | null;
  usdMin: number | null;
  usdMax: number | null;
}>;

/**
 * Стоимость обучения в год для программы: строка именно этой программы,
 * иначе строка её уровня, иначе общая строка вуза. Строки других периодов
 * не пересчитываются (семестр × 2 был бы догадкой). Несколько строк одного
 * приоритета (языки обучения) дают вилку; разные валюты — только по USD.
 */
export function programTuition(
  rows: readonly CostRow[],
  program: Readonly<{ id: string; level: UniversityLevel }> | null,
): ProgramTuition | null {
  const yearly = rows.filter((row) => row.kind === "tuition" && row.period === "year");
  const tiers = [
    program ? yearly.filter((row) => row.programId === program.id) : [],
    program ? yearly.filter((row) => row.programId === null && row.studyLevel === program.level) : [],
    yearly.filter((row) => row.programId === null && row.studyLevel === null),
  ];
  const picked = tiers.find((tier) => tier.length > 0);
  if (!picked) return null;
  const currencies = new Set(picked.map((row) => `${row.currency}/${row.exponent}`));
  const usdKnown = picked.every((row) => row.usdApproxMin !== null);
  const usdMin = usdKnown ? Math.min(...picked.map((row) => row.usdApproxMin as number)) : null;
  const usdTop = usdKnown ? Math.max(...picked.map((row) => row.usdApproxMax ?? (row.usdApproxMin as number))) : null;
  if (currencies.size > 1) {
    return usdMin === null ? null : {
      currency: "USD", exponent: 0, minMinor: usdMin, maxMinor: usdTop !== usdMin ? usdTop : null,
      usdMin, usdMax: usdTop !== usdMin ? usdTop : null,
    };
  }
  const minMinor = Math.min(...picked.map((row) => row.amountMinMinor));
  const top = Math.max(...picked.map((row) => row.amountMaxMinor ?? row.amountMinMinor));
  return {
    currency: picked[0].currency,
    exponent: picked[0].exponent,
    minMinor,
    maxMinor: top !== minMinor ? top : null,
    usdMin,
    usdMax: usdTop !== usdMin ? usdTop : null,
  };
}

/**
 * Ближайший набор программы: самый ранний месяц начала обучения не раньше
 * текущего, только у наборов open/announced (как «Ближайший набор» вуза).
 */
export function programNextStartMonth(program: Pick<UniversityProgram, "intakes">, now: Date): string | null {
  const thisMonth = now.toISOString().slice(0, 7);
  let next: string | null = null;
  for (const intake of program.intakes) {
    if (intake.status !== "open" && intake.status !== "announced") continue;
    const month = intake.startMonth ?? intake.startDate?.slice(0, 7) ?? null;
    if (month !== null && month >= thisMonth && (next === null || month < next)) next = month;
  }
  return next;
}

/** Тест интересов на странице «Профессии»: начат ли, сколько отвечено, профиль. */
export type OrvisState = Readonly<{
  questionCount: number;
  draftAnswered: number | null;
  completed: boolean;
  profile: OrvisProfile | null;
}>;

/** Строка таблицы «Где учиться в EVO»: связь карточки, решённая по каталогу. */
export type ProfessionProgramRow = Readonly<{
  ref: ProfessionLinkedProgramRef;
  institutionId: string | null;
  institutionName: string | null;
  countryName: LocalizedText | null;
  programFound: boolean;
  favored: boolean;
  tuition: ProgramTuition | null;
  /** Ближайший месяц начала (YYYY-MM) или null — набор не опубликован. */
  nextStartMonth: string | null;
}>;
