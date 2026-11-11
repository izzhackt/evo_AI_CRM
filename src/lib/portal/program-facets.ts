import type { UniversityProgram } from "../platform-university-catalog";

/**
 * Признаки программы для подбора на странице вуза (10.11.2026, «детальный фильтр, чтобы в выдаче было 2-3 карточки»).
 * В каталоге нет поля «направление», поэтому оно выводится из английского названия программы по ключевым словам; чего
 * не узнали - «Другое» (`other`), а не догадка. Месяцы начала - из дат набора и из русских названий месяцев в подписи
 * набора («Февраль / июль / октябрь»). Длительность - из текста «3 года», «1,5 года», «18 месяцев»; не разобрали - `null`.
 * Неизвестные месяц и длительность программу из подбора не убирают (`programMatches`). Чистые функции, без React.
 */

export const PROGRAM_FIELDS = [
  "it", "business", "engineering", "medicine", "law", "design", "education", "science", "social", "hospitality", "other",
] as const;
export type ProgramField = (typeof PROGRAM_FIELDS)[number];

export const PROGRAM_DURATIONS = ["short", "two", "three", "four"] as const;
export type ProgramDuration = (typeof PROGRAM_DURATIONS)[number];

export type ProgramFacets = Readonly<{ field: ProgramField; months: readonly number[]; duration: ProgramDuration | null }>;

// Порядок важен: первое совпадение решает («Business Information Technology» - IT, «Biomedical Engineering» - медицина,
// «Tourism Management» - туризм, а не бизнес).
const FIELD_RULES: readonly (readonly [ProgramField, RegExp])[] = [
  ["law", /\blaws?\b|\blegal\b|\bllb\b|\bllm\b|juris|criminal|shariah/i],
  ["it", /comput|software|information|\bit\b|\bdata\b|artificial intelligence|cyber|informatic|network|multimedia|game|programming|visual effects|intelligent system|information security|\bgis\b|remote sensing/i],
  ["medicine", /medic|nurs|pharm|dent|health|biomed|surg|\bmbbs\b|clinic|physio|optometr|nutrition|dietet|rehabilit|veterinar|midwif|optician|anaesthe|anesthe|epidemiolog|sport|fitness|obstetric|gynaec|ophthalm|paediatr|pediatr|patholog|radiolog|audiolog|strength and conditioning/i],
  ["engineering", /engineer|mechatron|electr|mechanic|civil|aerospace|aeronaut|aircraft|robot|automat|petroleum|manufactur|maritime|textile|surveying|construction|material|renewable energy/i],
  ["hospitality", /hospitality|tourism|hotel|culinary|patisserie|pastry|bakery|gastronom|\bevents?\b|pelancongan/i],
  ["business", /business|commerce|accounting|account|financ|econom|management|marketing|\bmba\b|banking|actuar|logistic|supply chain|entrepreneur|technopreneur|human resource|real estate/i],
  ["design", /design|architect|\barts?\b|music|film|media|animation|fashion|creative|photograph|interior|screen|stage|acting|cinema|dance|drama|planning|urban|land administration/i],
  ["education", /education|teaching|\btesl\b|pedagog|early childhood|measurement and assessment/i],
  ["science", /science|physics|chemi|biolog|mathemat|statistic|biotech|environment|agricult|food|geolog|geograph|sustainab/i],
  ["social", /social|politic|international|communication|journalism|sociolog|histor|philosoph|humanit|islamic|language|english|chinese|\bhsk\b|linguist|literature|translat|governance|global|studies|quran|hadith|usuluddin|dakwah|community|public administration|public policy|psycholog|counsel|behaviou?r/i],
];

export function programField(title: string): ProgramField {
  return FIELD_RULES.find(([, rule]) => rule.test(title))?.[0] ?? "other";
}

const MONTH_STEMS = ["январ", "феврал", "март", "апрел", "ма[йя]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"] as const;

/** Месяцы начала (1-12) по всем наборам программы, по возрастанию, без повторов. */
export function programMonths(program: UniversityProgram): readonly number[] {
  const months = new Set<number>();
  for (const intake of program.intakes) {
    const date = intake.startDate ?? intake.startMonth;
    if (date) months.add(Number(date.slice(5, 7)));
    MONTH_STEMS.forEach((stem, index) => {
      if (new RegExp(`(^|[^а-яё])${stem}`, "iu").test(intake.label)) months.add(index + 1);
    });
  }
  return [...months].filter((month) => month >= 1 && month <= 12).sort((a, b) => a - b);
}

/** Длительность в годах из «3 года», «1,5 года», «18 месяцев», «4 недели»; не разобрали - null. */
export function programYears(duration: string | null | undefined): number | null {
  const match = duration?.match(/(\d+(?:[.,]\d+)?)\s*(год|лет|year|мес|month|недел|week|семестр)/iu);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  if (unit.startsWith("мес") || unit.startsWith("month")) return value / 12;
  if (unit.startsWith("недел") || unit.startsWith("week")) return value / 52;
  if (unit.startsWith("семестр")) return value / 2;
  return value;
}

export function programDuration(duration: string | null | undefined): ProgramDuration | null {
  const years = programYears(duration);
  if (years === null) return null;
  return years < 2 ? "short" : years < 3 ? "two" : years < 4 ? "three" : "four";
}

export function programFacets(program: UniversityProgram): ProgramFacets {
  return { field: programField(program.title), months: programMonths(program), duration: programDuration(program.duration) };
}

/** Выбор в подборе: пустая строка - «Все». Месяц - число 1-12 строкой. */
export type ProgramPick = Readonly<{ level: string; field: string; month: string; duration: string }>;

/**
 * Подходит ли программа под выбор. Неизвестные месяц начала и длительность программу не прячут (10.11.2026, «верни все
 * программы»): в каталоге у четверти программ Малайзии их нет, и при «Июле» пропадали программы, которые могут
 * начинаться в июле.
 */
export function programMatches(item: ProgramFacets & Readonly<{ level: string }>, pick: ProgramPick): boolean {
  return (!pick.level || item.level === pick.level)
    && (!pick.field || item.field === pick.field)
    && (!pick.month || item.months.length === 0 || item.months.includes(Number(pick.month)))
    && (!pick.duration || item.duration === null || item.duration === pick.duration);
}

/** Сколько карточек видно, пока студент ничего не выбрал (10.11.2026: «только 4 сначала выведем»). */
export const PROGRAMS_FIRST = 4;

/** Без фильтра - первые четыре (или все после «Показать все»), с любым фильтром или поиском - все подходящие. */
export function visiblePrograms<T>(items: readonly T[], filtered: boolean, expanded: boolean): readonly T[] {
  return filtered || expanded ? items : items.slice(0, PROGRAMS_FIRST);
}
