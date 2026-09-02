/**
 * Типы профиля.
 *
 * Разделены намеренно на две части:
 *
 * - `PersonProfile` — то, что модель знает на самом деле. Приходит из
 *   `profile-source.ts`, читается из PostgreSQL.
 * - `ProfileDraft` — то, чего в модели пока нет: анкета, план платежей, типы
 *   документов, ответственный. Приходит образцом со страницы, а не из базы.
 *
 * Граница проведена в типах, а не в комментарии, чтобы её нельзя было
 * случайно стереть: если поле переехало из образца в базу, это видно по
 * тому, что оно поменяло тип.
 *
 * Чего сегодня нет в схеме (проверено): `evo_people` знает про человека ровно
 * имя, телефон и почту; у документа нет типа; плана платежей нет; сущности
 * сотрудника нет вовсе. Подробно — docs/design/v3/frontend-rules.md.
 */

export type ProfilePick = Readonly<{ id: string; name: string; student: boolean }>;

export type ProfileApplication = Readonly<{
  id: string;
  institution: string;
  program: string;
  intake: string;
  status: string;
  nextAction: string | null;
  nextActionAt: string | null;
}>;

export type ProfileVisaMilestone = Readonly<{
  id: string;
  kind: string;
  status: string;
  due: string | null;
  blockedReason: string | null;
}>;

export type ProfileEvent = Readonly<{
  id: string;
  transition: string;
  role: string;
  at: string;
}>;

/** Настоящие данные. */
export type PersonProfile = Readonly<{
  leadId: string;
  person: string;
  email: string | null;
  phone: string | null;
  student: boolean;
  stage: string;
  caseStatus: string | null;
  source: string;
  qualification: string | null;
  arrived: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  handoff: Readonly<{ at: string; contract: boolean; payment: boolean; override: boolean }> | null;
  applications: readonly ProfileApplication[];
  visa: readonly ProfileVisaMilestone[];
  financeStop: string | null;
  timeline: readonly ProfileEvent[];
}>;

/** Один пункт чеклиста документов. */
export type DocumentItem = Readonly<{
  name: string;
  /** Есть ли документ. */
  present: boolean;
  /** Приложенный файл, если он есть. */
  file: string | null;
  /** Когда приложили. */
  at: string | null;
}>;

export type DocumentGroup = Readonly<{ title: string; items: readonly DocumentItem[] }>;

export type Payment = Readonly<{
  name: string;
  amount: string;
  /** Оплачен, ждёт срока, просрочен. */
  state: "paid" | "due" | "overdue";
  at: string;
}>;

export type Fact = Readonly<{ label: string; value: string | null }>;

/** Образец: того, что здесь перечислено, в модели пока нет. */
export type ProfileDraft = Readonly<{
  /** Сотрудника в EVO не существует — есть только три роли. */
  responsible: string | null;
  provider: string | null;
  person: readonly Fact[];
  study: readonly Fact[];
  documents: readonly DocumentGroup[];
  otherFiles: readonly Readonly<{ name: string; size: string; at: string }>[];
  budget: string | null;
  currency: string | null;
  payments: readonly Payment[];
  paid: string | null;
  remaining: string | null;
  /** Доля оплаченного, 0–100. null — считать не из чего. */
  paidPercent: number | null;
  contractSignedAt: string | null;
}>;

export const TABS = [
  { key: "overview", title: "Обзор" },
  { key: "anketa", title: "Анкета" },
  { key: "documents", title: "Документы" },
  { key: "money", title: "Деньги" },
  { key: "history", title: "История" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export function isTabKey(value: unknown): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}
