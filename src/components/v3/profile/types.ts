import type { FixedRole } from "@/lib/fixed-role-policy";
import type { StudentApplication } from "@/lib/student-application-contract";
import type {
  PlatformApplicationQueueRow,
  PlatformStudentCaseView,
} from "@/lib/platform-admissions";
import type {
  PlatformCaseFinanceControl,
} from "@/lib/platform-finance-control";
import type { PlatformSalesWorkflowLead } from "@/lib/platform-sales-contract";
import type { PlatformSalesLinkedConversation } from "@/lib/platform-sales";
import type { LeadHandoffStripRead } from "@/lib/sales-numbers-contract";
import type { HandoffAcknowledgement, SalesHandoffAcknowledgement } from "@/lib/platform-handoff-acknowledgement";
import type {
  PlatformLeadAdmissionsGateSnapshot,
  PlatformLeadAdmissionsHandoffSnapshot,
  PlatformStudentCaseHandoffContext,
} from "@/lib/platform-student-handoff";
import type { PlatformCaseVisa } from "@/lib/platform-case-operations-contract";
import type { AdmissionsDirection } from "@/lib/platform-admissions-playbook-contract";
import type {
  PlatformCaseContractWorkspace,
  PlatformContractRetryOperation,
} from "@/lib/platform-contract-workflow";
import type {
  PlatformCaseNoteSubject,
} from "@/lib/platform-case-notes";

import type { DocumentGroup } from "./document-types";
import type { PlatformStudentProfileFieldsSnapshot } from "@/lib/platform-student-profile-fields";
import type { PlatformCaseDocumentWorkspace } from "@/lib/platform-private-documents";
import type { LeadSaleConditions } from "@/lib/lead-sale-conditions-contract";
import type { LeadCabinetCase } from "@/lib/v3/lead-cabinet-source";

export type ProfileFieldSourceVersion = Readonly<{
  id: string; filename: string; versionNumber: number; downloadReady: boolean;
}>;

/** Current originals for explicit selection plus exactly referenced history. */
export function profileFieldSourceVersions(
  workspace: PlatformCaseDocumentWorkspace | null,
  fields: PlatformStudentProfileFieldsSnapshot | null,
  preview: boolean,
): readonly ProfileFieldSourceVersion[] {
  if (!workspace || !fields?.profile) return [];
  const referenced = new Set(fields.fields.flatMap(field => [
    field.sourceDocumentVersionId, ...field.proposals.map(proposal => proposal.sourceDocumentVersionId),
  ]).filter((id): id is string => id !== null));
  const versions = new Map<string, ProfileFieldSourceVersion>();
  const currentVersionIds = new Set(workspace.slots.map(slot => slot.currentVersionId));
  for (const slot of [...workspace.slots, ...workspace.removedSlots]) {
    for (const version of slot.versions) {
      const current = currentVersionIds.has(version.documentVersionId);
      if (!current && !referenced.has(version.documentVersionId)) continue;
      versions.set(version.documentVersionId, {
        id: version.documentVersionId, filename: version.originalFilename,
        versionNumber: version.versionNumber, downloadReady: version.downloadReady && !preview,
      });
    }
  }
  return [...versions.values()];
}

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

export type ProfileRouteTarget =
  | Readonly<{ leadId: string; studentCaseId: null }>
  | Readonly<{ leadId: null; studentCaseId: string }>;

export type ProfileApplication = Readonly<{
  id: string;
  institution: string;
  program: string;
  intake: string;
  isPrimary: boolean;
  universityDeadlineOn: string | null;
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
  at: string | null;
  href?: string;
  changedFields?: readonly string[];
}>;

/** Настоящие данные. */
export type PersonProfile = Readonly<{
  leadId: string | null;
  person: string;
  email: string | null;
  phone: string | null;
  student: boolean;
  stage: string | null;
  caseStatus: string | null;
  source: string | null;
  qualification: string | null;
  arrived: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  handoff: Readonly<{ at: string; contract: boolean; payment: boolean; override: boolean }> | null;
  applications: readonly ProfileApplication[];
  visa: readonly ProfileVisaMilestone[];
  financeStop: string | null;
  timeline: readonly ProfileEvent[];
  timelineOlderHref?: string | null;
  timelineLatestHref?: string | null;
}>;

export type ProfileActorRole = FixedRole;
export type ProfileSalesActorRole = Extract<FixedRole, "admin" | "sales">;

/** Canonical read model used by the profile's Sales-to-Admissions controls. */
export type ProfileSalesHandoffSnapshot = PlatformLeadAdmissionsHandoffSnapshot & Readonly<{
  canOpenCase: boolean;
}>;

/** Navigation follows the resolved case read, not permission to submit again. */
export function profileSalesHandoffSnapshot(
  handoff: PlatformLeadAdmissionsHandoffSnapshot,
  caseView: PlatformStudentCaseView | null,
  preview: boolean,
): ProfileSalesHandoffSnapshot {
  return Object.freeze({ ...handoff, canOpenCase: !preview && handoff.caseId !== null
    && caseView?.access === "full"
    && caseView.studentCase.studentCaseId === handoff.caseId
    && caseView.studentCase.organizationId === handoff.organizationId });
}

export type ProfileSalesSnapshot = Readonly<{
  lead: PlatformSalesWorkflowLead;
  gate: PlatformLeadAdmissionsGateSnapshot;
  handoff: ProfileSalesHandoffSnapshot;
  /**
   * Полоса «Передача» (Э2, миграция 247): этап по правилу доски и
   * доказательства передачи с датами. `unavailable` — чтение не удалось:
   * ни этапа, ни галочек наугад.
   */
  strip: LeadHandoffStripRead;
  /**
   * Card ↔ chat link (plan §4/§12): `staff_sales_lead_detail` already reads
   * this (platform-sales.ts's `getPlatformSalesLead`); it was fetched but
   * never surfaced in the UI before this slice.
   */
  linkedConversations: readonly PlatformSalesLinkedConversation[];
}>;

export type ProfileNotesSnapshot = Readonly<{
  subject: PlatformCaseNoteSubject;
  rows: readonly Readonly<{
    body: string;
    authorDisplayName: string;
    createdAt: string;
  }>[];
}>;

export type ProfileAdmissionsRequestIds = Readonly<{
  createApplication: string;
  applications: Readonly<Record<string, string>>;
  applicationDetails: Readonly<Record<string, string>>;
  createStops: Readonly<Record<string, string>>;
  resolveStops: Readonly<Record<string, string>>;
  /** «Партнёр и решение» save per application (unified workflow S7). */
  partnerDetails: Readonly<Record<string, string>>;
  /** OTH-4: «Отметить статус» save per application, own id/form/RPC. */
  changeStatus: Readonly<Record<string, string>>;
}>;

/**
 * Партнёр и решение — editable since unified workflow S7 (plan §8, §11). See
 * `readApplicationPartnerDetails` in `src/lib/v3/admissions-source.ts` for
 * the key rename (a NEW, independent vocabulary — not the retired playbook
 * editor's camelCase keys) and the migration-184 write RPC.
 */
export type ApplicationPartnerDetails = Readonly<{
  applicationId: string;
  version: string;
  partnerContact: string | null;
  externalLink: string | null;
  decisionReference: string | null;
  decisionNote: string | null;
}>;

export type ProfileAdmissionsWorkspace = Readonly<{
  studentCaseId: string;
  caseState: "pending" | "active" | "closed";
  /** Unified workflow S8: source_key-derived, NOT caseState-derived (a legacy pending case and a cabinet-pending case share caseState==='pending'). */
  isCabinetCase: boolean;
  /** Unified workflow S4: the case DTO's own direction, replacing CaseHeader's deleted route-workspace read. */
  direction: AdmissionsDirection | null;
  applications: readonly PlatformApplicationQueueRow[];
  /**
   * Kept in the model, intentionally not rendered (unified workflow S4): the
   * visa-case CRUD Card is retired (plan §11 — no separate visa case,
   * mandatory statuses or CRM-side workflow), but `getPlatformCaseVisa`
   * stays a real, load-bearing read elsewhere (portal history, the staff
   * visa queue in `platform-admissions-workspace.ts`). Same treatment as
   * `PersonProfile.visa` — see tabs.tsx's comment above «Как он к нам
   * пришёл».
   */
  visa: PlatformCaseVisa | null;
  finance: PlatformCaseFinanceControl | null;
  requestIds: ProfileAdmissionsRequestIds;
}>;

/** Canonical BW6 artifacts; Sales provenance exists only for handed-off cases. */
export type ProfileContractSnapshot = Readonly<{
  workspace: PlatformCaseContractWorkspace;
  handoff: PlatformStudentCaseHandoffContext | null;
}>;

/** Bounded retry identity preserved across a fail-closed action redirect. */
export type ProfileContractRetry = Readonly<{
  requestId: string;
  operation: PlatformContractRetryOperation;
  subjectId?: string;
}>;

/** One server-generated id per independently retryable command form. */
export type ProfileSalesRequestIds = Readonly<{
  contract: string;
  firstPayment: string;
  override: string;
  handoff: string;
  /** «Доступ к платформе» approve/reject on the lead card Overview (unified workflow S1). */
  platformAccess: string;
  /** «Условия продажи» save on the lead card Overview (unified workflow S2). */
  saleConditions: string;
  /** «Подготовить кабинет» on the lead card «Доступ к платформе» (unified workflow S7). */
  prepareLeadCabinet: string;
  /**
   * «Пожелания» / «Образование» / «Условия» (unified workflow S7): own
   * request ids, distinct from `saleConditions` above — all four blocks
   * write the same row, so sharing one id risks a same-user, same-instant
   * double-submit reusing an already-consumed request id before the
   * post-save `router.refresh()` remounts every block with fresh state.
   */
  wishesCard: string;
  educationCard: string;
  conditionsCard: string;
}>;

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
  access: Readonly<{ documents: boolean; finance: boolean; studentProfile: boolean; contract: boolean }>;
  routeTarget: ProfileRouteTarget;
  /** Отображаемое имя ответственного сотрудника, если проекция его возвращает. */
  responsible: string | null;
  provider: string | null;
  person: readonly Fact[];
  study: readonly Fact[];
  /** null means this section was not authorized/loaded, not an absent profile. */
  profileFields: PlatformStudentProfileFieldsSnapshot | null;
  studentApplication: StudentApplication | null;
  profileFieldSources: readonly ProfileFieldSourceVersion[];
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
  admissions: ProfileAdmissionsWorkspace | null;
  /** Full BW6 contract/report workspace; absent for leads and Sales views. */
  contract: ProfileContractSnapshot | null;
  handoffAcknowledgement: (HandoffAcknowledgement & Readonly<{ requestId: string }>) | null;
  salesHandoffAcknowledgement: SalesHandoffAcknowledgement | null;
  /**
   * «Условия продажи» (unified workflow S2): populated only on the lead-only
   * Overview branch (readLeadProfile without a loaded full case) — the block
   * where заполнение условий happens before any report save. null elsewhere.
   */
  saleConditions: LeadSaleConditions | null;
  /**
   * «Подготовить кабинет» (unified workflow S7): populated only on the
   * lead-only Overview branch, same scoping as `saleConditions` above. null
   * on a full case (a case already exists by definition there).
   */
  leadCabinetCase: LeadCabinetCase | null;
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
  // The URL contract (?tab=route) is pinned by tests/v3-operational-parity.test.mjs
  // and CuratorDay's link — only the visible title changes (plan §8/§13).
  { key: "route", title: "Вузы и программы" },
  { key: "anketa", title: "Анкета" },
  { key: "documents", title: "Документы" },
  { key: "money", title: "Договор и оплата" },
  { key: "history", title: "История" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export function buildV3ProfileHref(
  target: ProfileRouteTarget,
  tab: string,
): string {
  const query = new URLSearchParams();
  if (target.leadId) query.set("id", target.leadId);
  if (target.studentCaseId) query.set("case", target.studentCaseId);
  query.set("tab", tab);
  return `/v3/profile?${query.toString()}`;
}

/**
 * Вкладки этого человека.
 *
 * Документы и договор заводятся на дело студента. Пока человек лид, дела нет —
 * и этих вкладок нет тоже: ни пустых, ни с объяснением, почему они пустые.
 */
export function tabsFor(
  student: boolean,
  access: ProfileDraft["access"],
  hasAdmissions: boolean,
): readonly (typeof TABS)[number][] {
  return TABS.filter((tab) => {
    if (tab.key === "documents") return student && access.documents;
    if (tab.key === "anketa") return !student || access.studentProfile;
    if (tab.key === "money") return !student || access.finance || access.contract;
    if (tab.key === "route") return student && hasAdmissions;
    return true;
  });
}

/**
 * Вкладка из адреса. Чужая или недоступная этому человеку — открывается обзор:
 * `?tab=documents` у лида не должен ронять страницу.
 */
export function resolveTab(
  value: unknown,
  student: boolean,
  access: ProfileDraft["access"],
  hasAdmissions: boolean,
): TabKey {
  // Existing contract links keep their outcome/retry parameters in place.
  // The alias grants navigation only to the independently authorized section.
  if (value === "contract") return student && access.contract ? "money" : "overview";
  const found = tabsFor(student, access, hasAdmissions).find((tab) => tab.key === value);
  return found ? found.key : "overview";
}
