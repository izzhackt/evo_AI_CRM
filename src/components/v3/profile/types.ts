import type { FixedRole } from "@/lib/fixed-role-policy";
import type { PlatformSalesWorkflowLead } from "@/lib/platform-sales-contract";
import type {
  PlatformLeadAdmissionsGateSnapshot,
  PlatformLeadAdmissionsHandoffSnapshot,
} from "@/lib/platform-student-handoff";

/**
 * Типы профиля.
 *
 * Разделены намеренно на две части:
 *
 * - `PersonProfile` — канонический lead/case snapshot from Supabase.
 * - `ProfileDraft` — additional canonical profile, checklist and finance
 *   projections composed by the V3 adapter. The historical type name is kept
 *   for component stability; it is not demo or fixture data.
 *
 * Граница проведена в типах, а не в комментарии, чтобы её нельзя было
 * случайно стереть: если поле переехало из образца в базу, это видно по
 * тому, что оно поменяло тип.
 *
 * Missing domain fields remain null or empty. The UI never fills them with a
 * sample person, file, payment or employee.
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

export type ProfileSalesActorRole = Extract<FixedRole, "admin" | "sales">;

/** Canonical read model used by the profile's Sales-to-Admissions controls. */
export type ProfileSalesSnapshot = Readonly<{
  lead: PlatformSalesWorkflowLead;
  gate: PlatformLeadAdmissionsGateSnapshot;
  handoff: PlatformLeadAdmissionsHandoffSnapshot;
}>;

/** One server-generated id per independently retryable command form. */
export type ProfileSalesRequestIds = Readonly<{
  contract: string;
  firstPayment: string;
  override: string;
  handoff: string;
}>;

/**
 * Пункт заготовки документов — только имя.
 *
 * Файла здесь нет намеренно: приложенный файл появляется в браузере и живёт
 * в состоянии вкладки, пока хранилище не догонит. Имя файла без самого файла
 * было бы нарисованной галочкой.
 */
export type DocumentItem = Readonly<{ id: string; name: string }>;

export type DocumentGroup = Readonly<{ title: string; items: readonly DocumentItem[] }>;

export type Payment = Readonly<{
  name: string;
  amount: string;
  /** Оплачен, ждёт срока, просрочен. */
  state: "paid" | "due" | "overdue";
  at: string;
}>;

export type Fact = Readonly<{ label: string; value: string | null }>;

/** Дополнительные реальные проекции профиля; отсутствующие данные пусты. */
export type ProfileDraft = Readonly<{
  /** Отображаемое имя ответственного сотрудника, если проекция его возвращает. */
  responsible: string | null;
  provider: string | null;
  person: readonly Fact[];
  study: readonly Fact[];
  /** Канонический чеклист документов этого дела. */
  documents: readonly DocumentGroup[];
  /**
   * Есть в модели, намеренно не рисуется.
   *
   * Отдельной вкладки «Файлы» нет: файл живёт при своём пункте в документах,
   * и второй список перечислял бы те же файлы во втором месте. К тому же имя
   * файла, к которому не привязан сам файл, — нарисованная галочка.
   */
  otherFiles: readonly Readonly<{ name: string; size: string; at: string }>[];
  budget: string | null;
  currency: string | null;
  payments: readonly Payment[];
  paid: string | null;
  remaining: string | null;
  /** Доля оплаченного, 0–100. null — считать не из чего. */
  paidPercent: number | null;
  /**
   * Есть в модели, намеренно не рисуется.
   *
   * Дату договора во вкладке «Деньги» показывает карточка «Договор», и берёт
   * она её из `profile.handoff` — то есть из настоящих данных. Придуманная
   * дата рядом с настоящей была бы вторым источником правды об одном и том же
   * событии.
   */
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

/**
 * Вкладки этого человека.
 *
 * Документы заводятся на дело студента. Пока человек лид, дела нет — и
 * вкладки нет тоже: ни пустой, ни с объяснением, почему она пустая.
 */
export function tabsFor(student: boolean): readonly (typeof TABS)[number][] {
  return student ? TABS : TABS.filter((tab) => tab.key !== "documents");
}

/**
 * Вкладка из адреса. Чужая или недоступная этому человеку — открывается обзор:
 * `?tab=documents` у лида не должен ронять страницу.
 */
export function resolveTab(value: unknown, student: boolean): TabKey {
  const found = tabsFor(student).find((tab) => tab.key === value);
  return found ? found.key : "overview";
}
