/**
 * «Вузы и программы» дела (Э8.2, решение владельца 28.09.2026): один список
 * вузов — заявки дела (чтение 190) и подготовки из каталога (214/218) одной
 * строкой на вуз. Чистая логика без React: по ней работают вкладка,
 * статический рендер и unit-тест. Новых чтений и команд здесь нет.
 */
import type { PlatformApplicationQueueRow, PlatformApplicationStatus } from "../../../lib/platform-application-contract.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import type { CatalogPreparation } from "../../../lib/portal/catalog-preparations.ts";
import { applicationPathStep, applicationPathWord, country, degree } from "../../../lib/v3/wording.ts";
import { dueWordOf, formatQueueDay, type DueWordView } from "../queue/due-bucket.ts";

/** Тон слова шага: оффер и зачисление — «ok», отказ вуза — проблема, остальное — нейтрально. */
export type UniversityPathTone = "neutral" | "ok" | "danger";

/**
 * Срок подачи строки: «30.11» по Бишкеку (год — только не текущий) и слово
 * срока, пока заявка не подана. Срок из каталога, который при выборе нужно
 * было подтвердить, словом срока не пугает — он назван «нужно подтвердить».
 */
export type UniversityDeadline = Readonly<{
  dateTime: string;
  text: string;
  word: DueWordView | null;
  unconfirmed: boolean;
}>;

export type UniversityRow = Readonly<{
  applicationId: string;
  /** Заявка из чтения дела; null — подготовка из каталога есть, а строки заявки в чтении нет. */
  application: PlatformApplicationQueueRow | null;
  preparation: CatalogPreparation | null;
  university: string;
  program: string | null;
  /** Набор — только у подготовки из каталога: `intake` строки заявки — набор дела, он одинаков у всех строк. */
  intake: string | null;
  primary: boolean;
  status: PlatformApplicationStatus;
  /** Шаг пути «вариант → заявка подана → решение»; null — заявка с пути сошла (отозвана, закрыта). */
  step: 0 | 1 | 2 | null;
  word: string | null;
  tone: UniversityPathTone;
  deadline: UniversityDeadline | null;
  /** Страна и ступень заявки словами (без сырых ключей). */
  facts: readonly string[];
  addedBy: string | null;
}>;

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function pathTone(status: PlatformApplicationStatus): UniversityPathTone {
  if (status === "offer" || status === "enrolled") return "ok";
  return status === "rejected" ? "danger" : "neutral";
}

function selection(preparation: CatalogPreparation | null) {
  const program = preparation?.content.programs.find((item) => item.id === preparation.programId) ?? null;
  const intake = program?.intakes.find((item) => item.id === preparation?.intakeId) ?? null;
  return { program, intake };
}

function rowDeadline(
  application: PlatformApplicationQueueRow | null,
  preparation: CatalogPreparation | null,
  status: PlatformApplicationStatus,
  now: Date,
): UniversityDeadline | null {
  // Срок, записанный в заявке («Параметры заявки»), главнее опубликованного в каталоге.
  const own = application?.universityDeadlineOn ?? null;
  const day = own ?? selection(preparation).intake?.applicationDeadline ?? null;
  if (!day || !DAY.test(day)) return null;
  const unconfirmed = own === null && preparation?.deadlineStateAtSelection === "needs_confirmation";
  const beforeSubmission = status === "preparation" || status === "ready";
  return Object.freeze({
    dateTime: day,
    text: formatQueueDay(day, dayInOrganizationTimezone(now)),
    word: beforeSubmission && !unconfirmed ? dueWordOf({ dueOn: day, dueAt: null }, now) : null,
    unconfirmed,
  });
}

function universityRow(
  application: PlatformApplicationQueueRow | null,
  preparation: CatalogPreparation | null,
  now: Date,
): UniversityRow {
  const { program, intake } = selection(preparation);
  // Статус подготовки читается вместе с ней (218) и свежее строки заявки — как прежде.
  const status = preparation?.applicationStatus ?? application!.status;
  const facts = application
    ? [country(application.country), degree(application.degree)]
    : [country(preparation?.content.country)];
  return Object.freeze({
    applicationId: application?.universityApplicationId ?? preparation!.applicationId,
    application,
    preparation,
    university: preparation?.content.name ?? application!.institutionName,
    program: program?.title ?? application?.programName ?? null,
    intake: intake?.label ?? null,
    primary: application?.isPrimary ?? false,
    status,
    step: applicationPathStep(status),
    word: applicationPathWord(status),
    tone: pathTone(status),
    deadline: rowDeadline(application, preparation, status, now),
    facts: Object.freeze(facts.filter((fact): fact is string => fact !== null)),
    addedBy: application?.createdByDisplayName ?? null,
  });
}

/**
 * Строки списка: заявка и её подготовка из каталога — одна строка; основной
 * вариант первым, остальные — в порядке чтения (как «Обзор»); подготовки без
 * строки заявки в чтении — в конце.
 */
export function universityRows(
  applications: readonly PlatformApplicationQueueRow[],
  preparations: readonly CatalogPreparation[],
  now: Date,
): readonly UniversityRow[] {
  const byApplication = new Map(preparations.map((preparation) => [preparation.applicationId, preparation]));
  const rows = [...applications]
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
    .map((application) => universityRow(application, byApplication.get(application.universityApplicationId) ?? null, now));
  const listed = new Set(applications.map((application) => application.universityApplicationId));
  const orphans = preparations.filter((preparation) => !listed.has(preparation.applicationId))
    .map((preparation) => universityRow(null, preparation, now));
  return Object.freeze([...rows, ...orphans]);
}

/**
 * Адрес «Пакета партнёру» строки: панель пакетов на этой вкладке, открытая, с
 * выбранной заявкой (`packet_application`). `routeHref` — адрес вкладки с
 * возвратом, как у остальных ссылок дела.
 */
export function partnerPacketHref(routeHref: string, applicationId: string): string {
  return `${routeHref}&panel=packets&packet_application=${encodeURIComponent(applicationId)}#partner-packets`;
}
