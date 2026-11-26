// Своя анкета студента (`own_student_application_v1`): общие правила разбора для всех мест приложения, которые её читают.
// Раньше их было три: «Ваша анкета» на «Главной» (`api/portal-reads.ts`), экран статуса анкеты
// (`features/registration/own-application.ts`) и шлюз доступа (`session/deps.ts`); каждый заново писал список статусов, а
// первый ещё и правила дат. Источник правил - `decodeStudentApplication` веба (src/lib/v3/student-application-source.ts, файл
// `server-only`, поэтому здесь копия; совпадение держит тест `own-application.test.ts`, который выполняет веб-функцию).

export const APPLICATION_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const isApplicationStatus = (value: unknown): value is ApplicationStatus => (APPLICATION_STATUSES as readonly unknown[]).includes(value);

/** Строка с моментом времени, который разбирается (веб `date()`). */
export const isTimestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Статус и даты анкеты: то, что читает «Главная» для отметок «отправлена» и «одобрена». */
export type ApplicationHead = Readonly<{ status: ApplicationStatus; submittedAt: string; decidedAt: string | null }>;

/**
 * Строгая «голова» анкеты, как у веба: статус из трёх, дата подачи, дата решения (или её нет), и решение есть у всех анкет, кроме
 * анкеты на рассмотрении (`pending` ⟺ `decided_at = null`). Всё остальное - `null`: вызывающий превращает его в свою ошибку
 * данных, чужая форма не показывается и дат не выдумывает.
 */
export function decodeApplicationHead(row: Readonly<Record<string, unknown>>): ApplicationHead | null {
  const { status, submitted_at: submittedAt, decided_at: decidedAt = null } = row;
  if (!isApplicationStatus(status) || !isTimestamp(submittedAt) || (decidedAt !== null && !isTimestamp(decidedAt))) return null;
  if ((status === "pending") !== (decidedAt === null)) return null;
  return { status, submittedAt, decidedAt };
}
