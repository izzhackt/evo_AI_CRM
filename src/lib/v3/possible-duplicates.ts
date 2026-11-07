/**
 * «Похоже, этот студент уже есть» (07.11.2026, пользователь: «сделай чтобы crm предупреждала о дубле»). Кабинет
 * «с нуля» в «Настройках» и одобрение анкеты заводят нового человека: студент с делом, получивший кабинет так,
 * становился вторым лидом и вторым делом. Перед этими действиями сотрудник видит похожих — дела и лиды с той же
 * фамилией и именем с тех же букв — и может открыть нужное дело. Это предупреждение, не запрет: «Всё равно…»
 * проходит. Файл чистый: чтения те же, что у Ctrl+K (`student-search-readers.ts`), тест подставляет свои.
 */
import type { ActivePlatformActor } from "../platform-auth.ts";
import { paletteLeadRow, paletteSearchAccess, paletteStudentRow, type PaletteReaders } from "./command-palette.ts";

/** Похожих в предупреждении; больше не нужно — хватит одного, чтобы остановиться. */
export const POSSIBLE_DUPLICATE_LIMIT = 5;
/** Строк каждого чтения: однофамильцев отбирает имя. */
const READ_LIMIT = 20;

export type PossibleDuplicate = Readonly<{
  kind: "case" | "lead";
  id: string;
  label: string;
  meta: string | null;
  href: string;
}>;
export type PossibleDuplicatePerson = Readonly<{ firstName: string; lastName: string }>;
/** Свои записи того, кого проверяют (лид и дело анкеты), — не дубли. */
export type PossibleDuplicateExclude = Readonly<{ leadId?: string | null; studentCaseId?: string | null }>;

function words(value: string): string[] {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Тот же человек по имени: фамилия целым словом и имя с тех же двух букв, в любом порядке слов. «Абурахман Сатыбалдиев»
 * и «Сатыбалдиев Абдурахман» — да; «Бакыт Сатыбалдиев» и «Айдана Сатыбалдиева» — нет.
 */
export function samePersonName(displayName: string, person: PossibleDuplicatePerson): boolean {
  const [surname] = words(person.lastName);
  const [given] = words(person.firstName);
  if (!surname || !given) return false;
  const name = words(displayName);
  const start = given.slice(0, 2);
  return name.includes(surname) && name.some((word) => word !== surname && word.startsWith(start));
}

/**
 * Похожие студенты и лиды для предупреждения. Ищет по фамилии теми же чтениями и правами, что поиск Ctrl+K (роль
 * без группы её не видит), отбирает по имени, свои записи пропускает. Сбой чтения — пустой ответ: предупреждение
 * не должно останавливать работу.
 */
export async function findPossibleDuplicates(
  actor: ActivePlatformActor,
  person: PossibleDuplicatePerson,
  readers: PaletteReaders,
  exclude: PossibleDuplicateExclude = {},
): Promise<readonly PossibleDuplicate[]> {
  const query = person.lastName.trim().split(/\s+/u)[0] ?? "";
  if (query.length < 2 || words(person.firstName).length === 0) return [];
  const access = paletteSearchAccess(actor);
  const [students, leads] = await Promise.all([
    access.students ? readers.students(actor, query, READ_LIMIT).catch(() => null) : null,
    access.leads ? readers.leads(actor, query, READ_LIMIT).catch(() => null) : null,
  ]);
  const found: PossibleDuplicate[] = [];
  for (const row of students?.rows ?? []) {
    if (row.studentCaseId === exclude.studentCaseId || !samePersonName(row.studentDisplayName, person)) continue;
    found.push({ kind: "case", ...paletteStudentRow(row) });
  }
  for (const row of leads?.rows ?? []) {
    if (row.leadId === exclude.leadId || row.clientDisplayName === null || !samePersonName(row.clientDisplayName, person)) continue;
    found.push({ kind: "lead", ...paletteLeadRow(row) });
  }
  return found.slice(0, POSSIBLE_DUPLICATE_LIMIT);
}
