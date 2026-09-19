import { staffPresentationCan, staffHasPermission, isStaffPreview } from "../platform-access.ts";
import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "../supabase/server";
import { parseCaseSectionAccess, readCaseProfileSections, type CaseSectionAccess } from "./case-access-contract";
import { loadProfileSalesContext } from "./profile-route-load";
import { loadStudentApplicationForCase, loadStudentApplicationForLead } from "./student-application-source";
import { readLeadSaleConditions } from "./lead-sale-conditions-source";
import { readLeadCabinetCase, readStudentCaseCabinetOrigin } from "./lead-cabinet-source";
import type { StudentApplication } from "@/lib/student-application-contract";
import { countryLabel } from "@/lib/student-application-presentation";
import { ADMISSIONS_DIRECTIONS, ADMISSIONS_ATTENTION, type AdmissionsDirection, type AdmissionsAttention } from "@/lib/platform-admissions-playbook-contract";
import { readProfileActivity, type ProfileActivityCursor } from "@/lib/v3/profile-activity-source";
import { getHandoffAcknowledgement, getSalesHandoffAcknowledgement, type HandoffAcknowledgement } from "@/lib/platform-handoff-acknowledgement";

import type {
  DocumentCaseLinkTarget,
  DocumentGroup,
} from "@/components/v3/profile/document-types";
import type {
  PersonProfile,
  ProfileAdmissionsWorkspace,
  ProfileContractSnapshot,
  ProfileDraft,
  ProfileRouteTarget,
  ProfileSalesSnapshot,
} from "@/components/v3/profile/types";
import {
  profileFieldSourceVersions,
  profileSalesHandoffSnapshot,
} from "@/components/v3/profile/types";
import {
  getPlatformStudentCaseView,
  listPlatformApplicationsForStudentCase,
  listPlatformStudentCaseLeadLinks,
  listPlatformStudentCases,
  parsePlatformAdmissionsCursor,
  parsePlatformAdmissionsUuid,
  type PlatformAdmissionsCursor,
  type PlatformApplicationQueueRow,
  type PlatformStudentCasePageItem,
  type PlatformStudentCaseSnapshot,
  type PlatformStudentCaseState,
} from "@/lib/platform-admissions";
import { getPlatformCaseVisa } from "@/lib/platform-case-operations";
import {
  readCaseNotes,
  type PlatformCaseNoteCursor,
  type PlatformCaseNotePage,
  type PlatformCaseNoteSubject,
} from "@/lib/platform-case-notes";
import type { PlatformCaseVisa } from "@/lib/platform-case-operations-contract";
import {
  getPlatformCaseFinanceControl,
  type PlatformCaseFinanceControl,
} from "@/lib/platform-finance-control";
import {
  getPlatformCaseContractWorkspace,
  type PlatformCaseContractWorkspace,
} from "@/lib/platform-contract-workflow";
import {
  getPlatformCaseDocumentWorkspace,
  type PlatformCaseDocumentWorkspace,
  type PlatformDocumentSlot,
} from "@/lib/platform-private-documents";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { getPlatformSalesLead } from "@/lib/platform-sales";
import {
  getPlatformLeadAdmissionsGate,
  getPlatformLeadAdmissionsHandoff,
  getPlatformStudentCaseHandoffContext,
  type PlatformStudentCaseHandoffContext,
} from "@/lib/platform-student-handoff";
import {
  getPlatformStudentProfile,
  type PlatformStudentProfileSnapshot,
} from "@/lib/platform-student-profile";
import {
  getPlatformStudentProfileFields,
  type PlatformStudentProfileFieldsSnapshot,
} from "@/lib/platform-student-profile-fields";

const DAY = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Bishkek",
});
const FULL_DAY = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Bishkek",
});

type V3ProfileCoreView = Readonly<{
  profile: PersonProfile;
  details: ProfileDraft;
  sales: ProfileSalesSnapshot | null;
}>;

type V3ProfileNotesView = Readonly<{
  subject: PlatformCaseNoteSubject;
  page: PlatformCaseNotePage;
}>;

export type V3ProfileView = Readonly<
  V3ProfileCoreView & { notes: V3ProfileNotesView }
>;

export type V3ProfileCaseDirectoryParams = Readonly<{
  active: boolean;
  cursor: PlatformAdmissionsCursor | null;
  invalid: boolean;
  query?: string;
  state?: PlatformStudentCaseState;
  direction?: AdmissionsDirection | "unknown";
  curatorMembershipId?: string;
  attention?: AdmissionsAttention;
}>;

export type V3ProfileCaseDirectoryRow = Readonly<{
  access: "full" | "sales_summary";
  admissionsDisplayName: string | null;
  leadId: string | null;
  operationalStage: string | null;
  overdueObligationCount: number | null;
  overdueTaskCount: number | null;
  rejectedDocumentCount: number | null;
  responsibleSalesDisplayName: string | null;
  state: PlatformStudentCaseState;
  studentCaseId: string;
  studentDisplayName: string;
  targetCountry: string | null;
  targetDegree: string | null;
  updatedAt: string | null;
  admissionsDirection?: AdmissionsDirection | null;
  nextAction?: string | null;
  nextActionDueOn?: string | null;
  /** S3 (plan §7): «Ожидает принятия»/«Нужно назначить куратора» row badges. [] for sales_summary rows. */
  attentionFlags: readonly AdmissionsAttention[];
}>;

export type V3ProfileCaseDirectory = Readonly<{
  hasNext: boolean;
  nextCursor: PlatformAdmissionsCursor | null;
  rows: readonly V3ProfileCaseDirectoryRow[];
}>;

type FullCaseData = Readonly<{
  access: CaseSectionAccess;
  studentCase: PlatformStudentCaseSnapshot;
  applications: readonly PlatformApplicationQueueRow[];
  visa: PlatformCaseVisa | null;
  finance: PlatformCaseFinanceControl | null;
  studentProfile: PlatformStudentProfileSnapshot | null;
  profileFields: PlatformStudentProfileFieldsSnapshot | null;
  studentApplication: StudentApplication | null;
  documents: PlatformCaseDocumentWorkspace | null;
  contract: PlatformCaseContractWorkspace | null;
  handoff: PlatformStudentCaseHandoffContext | null;
  handoffAcknowledgement: HandoffAcknowledgement;
}>;

type FinanceSummary = Pick<
  ProfileDraft,
  "budget" | "currency" | "payments" | "paid" | "remaining" | "paidPercent"
>;

function formatDate(value: string | null, full = false): string | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : (full ? FULL_DAY : DAY).format(date);
}

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function financeSummary(finance: PlatformCaseFinanceControl | null): FinanceSummary {
  const currencies = new Set(finance?.obligations.map((item) => item.currency) ?? []);
  const aggregateCurrency = currencies.size === 1
    ? [...currencies][0] ?? null
    : null;
  const totalMinor = finance?.obligations.reduce(
    (sum, item) => sum + item.amountMinor,
    0,
  ) ?? 0;
  const paidMinor = finance?.obligations.reduce(
    (sum, item) => sum + item.totalPaidMinor - item.totalRefundedMinor,
    0,
  ) ?? 0;
  const outstandingMinor = finance?.obligations.reduce(
    (sum, item) => sum + item.outstandingMinor,
    0,
  ) ?? 0;

  return {
    budget: aggregateCurrency && totalMinor > 0
      ? formatMoney(totalMinor, aggregateCurrency)
      : null,
    currency: aggregateCurrency,
    payments: (finance?.obligations ?? []).map((obligation) => ({
      name: obligation.label,
      amount: formatMoney(obligation.amountMinor, obligation.currency),
      state: obligation.status === "paid"
        ? "paid"
        : obligation.overdue || obligation.status === "overdue"
          ? "overdue"
          : "due",
      at: obligation.status === "paid"
        ? `оплачен ${formatDate(obligation.lastPaymentAt) ?? ""}`.trim()
        : `до ${formatDate(obligation.dueAt) ?? "не указано"}`,
    })),
    paid: aggregateCurrency && paidMinor > 0
      ? formatMoney(paidMinor, aggregateCurrency)
      : null,
    remaining: aggregateCurrency && outstandingMinor > 0
      ? formatMoney(outstandingMinor, aggregateCurrency)
      : null,
    paidPercent: totalMinor > 0 && aggregateCurrency
      ? Math.max(0, Math.min(100, Math.round((paidMinor / totalMinor) * 100)))
      : null,
  };
}

function profileApplications(
  applications: readonly PlatformApplicationQueueRow[],
): PersonProfile["applications"] {
  return applications.map((application) => ({
    id: application.universityApplicationId,
    institution: application.institutionName,
    program: application.programName,
    intake: application.intake ?? "не указано",
    isPrimary: application.isPrimary,
    universityDeadlineOn: application.universityDeadlineOn,
    status: application.status,
    nextAction: null,
    nextActionAt: null,
  }));
}

function profileVisa(visa: PlatformCaseVisa | null): PersonProfile["visa"] {
  return visa
    ? [{
        id: visa.visaCaseId,
        kind: "visa_case",
        status: visa.status,
        due: null,
        blockedReason: visa.note,
      }]
    : [];
}

function caseLinkTargetKey(kind: DocumentCaseLinkTarget["kind"], id: string): string {
  return `${kind}:${id}`;
}

function caseLinkTargetId(slot: PlatformDocumentSlot, index: number): string {
  const link = slot.caseLinks[index];
  if (!link) throw new Error("V3 profile document link projection is inconsistent.");
  if (link.targetKind === "university_application" && link.universityApplicationId) {
    return link.universityApplicationId;
  }
  if (link.targetKind === "visa_case" && link.visaCaseId) return link.visaCaseId;
  throw new Error("V3 profile document link projection is inconsistent.");
}

function profileDocumentCaseLinkTargets(
  slot: PlatformDocumentSlot,
  allowWrite: boolean,
  applications: readonly PlatformApplicationQueueRow[],
  visa: PlatformCaseVisa | null,
): readonly DocumentCaseLinkTarget[] {
  const targets: DocumentCaseLinkTarget[] = applications.map((application) => {
    const details = [
      application.intake ?? "интейк не указан",
      application.status,
      application.isPrimary ? "основная" : null,
      application.universityDeadlineOn
        ? `дедлайн ${application.universityDeadlineOn}`
        : null,
      `#${application.universityApplicationId.slice(0, 8)}`,
    ].filter((value): value is string => value !== null);
    return {
      kind: "university_application",
      id: application.universityApplicationId,
      label: `${application.institutionName}: ${application.programName} · ${details.join(" · ")}`,
      linked: false,
      requestId: allowWrite ? randomUUID() : null,
    };
  });
  if (visa) {
    targets.push({
      kind: "visa_case",
      id: visa.visaCaseId,
      label: `Визовое дело · ${visa.status}`,
      linked: false,
      requestId: allowWrite ? randomUUID() : null,
    });
  }

  const knownTargets = new Set(targets.map((target) =>
    caseLinkTargetKey(target.kind, target.id)
  ));
  const linkedTargets = new Set<string>();
  for (const [index, link] of slot.caseLinks.entries()) {
    const key = caseLinkTargetKey(link.targetKind, caseLinkTargetId(slot, index));
    if (!knownTargets.has(key)) {
      throw new Error("V3 profile document link projection is inconsistent.");
    }
    linkedTargets.add(key);
  }

  return Object.freeze(targets.map((target) => Object.freeze({
    ...target,
    linked: linkedTargets.has(caseLinkTargetKey(target.kind, target.id)),
  })));
}

function profileDocuments(
  workspace: PlatformCaseDocumentWorkspace,
  allowUpload: boolean,
  applications: readonly PlatformApplicationQueueRow[],
  visa: PlatformCaseVisa | null,
  allowReview: boolean,
): readonly DocumentGroup[] {
  if (workspace.slots.length === 0 && workspace.removedSlots.length === 0) return [];

  type ActiveGroup = Extract<DocumentGroup, { kind: "active" }>;
  type RemovedGroup = Extract<DocumentGroup, { kind: "removed" }>;

  const groups = new Map<string, ActiveGroup["items"][number][]>();
  for (const slot of workspace.slots) {
    const uploadRequestId = allowUpload ? randomUUID() : null;
    const metadataRequestId = allowUpload ? randomUUID() : null;
    const removalRequestId = allowUpload ? randomUUID() : null;
    const base = {
      id: slot.documentSlotId,
      name: slot.requirementLabel,
      groupLabel: slot.groupLabel,
      intentKind: slot.intentKind,
      version: slot.version,
      status: slot.status,
      uploadRequestId,
      metadataRequestId,
      removalRequestId,
      caseLinkTargets: profileDocumentCaseLinkTargets(
        slot,
        allowUpload,
        applications,
        visa,
      ),
    } as const;
    let item: ActiveGroup["items"][number];
    if (slot.currentVersionId === null) {
      item = {
        ...base,
        presence: "absent" as const,
        currentVersionId: null,
        downloadReady: false as const,
      };
    } else {
      const currentVersion = slot.versions.find(
        (version) => version.isCurrent && version.documentVersionId === slot.currentVersionId,
      );
      if (!currentVersion || slot.currentVersionNumber !== currentVersion.versionNumber) {
        throw new Error("V3 profile document projection is inconsistent.");
      }

      item = {
        ...base,
        presence: "present" as const,
        currentVersionId: currentVersion.documentVersionId,
        currentVersionNumber: currentVersion.versionNumber,
        currentFilename: currentVersion.originalFilename,
        latestReview: currentVersion.latestReview,
        reviewRequestId: allowReview && slot.status === "submitted" && currentVersion.storageFinalized
          ? randomUUID() : null,
        downloadReady: currentVersion.downloadReady,
      };
    }
    const group = groups.get(slot.groupLabel) ?? [];
    group.push(item);
    groups.set(slot.groupLabel, group);
  }

  const activeGroups: ActiveGroup[] = [...groups.entries()].map(([title, items]) => ({
    kind: "active",
    title,
    items: Object.freeze(items),
  }));

  const removedGroups = new Map<string, RemovedGroup["items"][number][]>();
  for (const slot of workspace.removedSlots) {
    const item: RemovedGroup["items"][number] = Object.freeze({
      id: slot.documentSlotId,
      name: slot.requirementLabel,
      groupLabel: slot.groupLabel,
      intentKind: slot.intentKind,
      removedAt: slot.removedAt,
      removalReason: slot.removalReason,
      versions: Object.freeze(slot.versions.map((version) => Object.freeze({
        id: version.documentVersionId,
        versionNumber: version.versionNumber,
        filename: version.originalFilename,
        submittedBy: version.submittedByDisplayName,
        submittedAt: version.createdAt,
        downloadReady: version.downloadReady,
      }))),
    });
    const group = removedGroups.get(slot.groupLabel) ?? [];
    group.push(item);
    removedGroups.set(slot.groupLabel, group);
  }

  const historyGroups: RemovedGroup[] = [...removedGroups.entries()].map(
    ([title, items]) => ({
      kind: "removed",
      title,
      items: Object.freeze(items),
    }),
  );

  return [...activeGroups, ...historyGroups];
}

function profileFacts(
  studentCase: PlatformStudentCaseSnapshot,
  studentProfile: PlatformStudentProfileSnapshot | null,
): Pick<ProfileDraft, "person" | "study"> {
  if (!studentProfile) return { person: [], study: [] };
  return {
    person: [
      { label: "Дата рождения", value: studentProfile.dateOfBirth },
      { label: "Гражданство", value: studentProfile.citizenshipCountry && /^[A-Z]{2}$/.test(studentProfile.citizenshipCountry)
        ? countryLabel(studentProfile.citizenshipCountry) : studentProfile.citizenshipCountry },
      { label: "Страна проживания", value: studentProfile.residencyCountry },
      { label: "Язык общения", value: studentProfile.communicationLanguage },
      {
        label: "Участники решения",
        value: studentProfile.decisionParticipantLabels.join(", ") || null,
      },
    ],
    study: [
      { label: "Целевая страна", value: studentCase.targetCountry },
      { label: "Ступень", value: studentCase.targetDegree },
      { label: "Направление", value: studentCase.programDirection },
      { label: "Интейк", value: studentCase.intake },
      { label: "Текущее образование", value: studentProfile.currentEducationSummary },
      { label: "Академический профиль", value: studentProfile.academicSummary },
      { label: "Языковой профиль", value: studentProfile.languageSummary },
      { label: "Бюджет", value: studentProfile.budgetBand },
    ],
  };
}

function admissionsWorkspace(
  data: FullCaseData,
  isCabinetCase: boolean,
): ProfileAdmissionsWorkspace {
  return {
    studentCaseId: data.studentCase.studentCaseId,
    caseState: data.studentCase.state,
    // S8 (plan §4): source_key-derived, NOT caseState-derived — a legacy
    // pending case and a cabinet-pending case share the same caseState.
    isCabinetCase,
    // Unified workflow S4: CaseHeader used to fetch this separately via the
    // now-deleted route workspace read; the case DTO already carries it.
    direction: data.studentCase.admissionsDirection ?? null,
    applications: data.applications,
    visa: data.visa,
    finance: data.finance,
    requestIds: {
      createApplication: randomUUID(),
      applications: Object.fromEntries(
        data.applications.map((application) => [
          application.universityApplicationId,
          randomUUID(),
        ]),
      ),
      applicationDetails: Object.fromEntries(
        data.applications.map((application) => [
          application.universityApplicationId,
          randomUUID(),
        ]),
      ),
      // «Партнёр и решение» (unified workflow S7): own per-application id,
      // distinct from applicationDetails above (a different form, a
      // different RPC).
      partnerDetails: Object.fromEntries(
        data.applications.map((application) => [
          application.universityApplicationId,
          randomUUID(),
        ]),
      ),
      createStops: Object.fromEntries(
        (data.finance?.obligations ?? []).map((obligation) => [
          obligation.paymentObligationId,
          randomUUID(),
        ]),
      ),
      resolveStops: Object.fromEntries(
        (data.finance?.obligations ?? []).flatMap((obligation) =>
          obligation.activeStopFactors.map((stop) => [stop.stopFactorId, randomUUID()]),
        ),
      ),
    },
  };
}

async function loadFullCase(
  actor: ActivePlatformActor,
  studentCase: PlatformStudentCaseSnapshot,
): Promise<FullCaseData> {
  const studentCaseId = studentCase.studentCaseId;
  const client = await createSupabaseServerClient();
  const sectionResponse = await client.schema("platform").rpc("staff_case_access_snapshot", {
    p_organization_id: actor.organizationId, p_student_case_id: studentCaseId,
  });
  if (sectionResponse.error) throw new Error("case_access_unavailable");
  const access = parseCaseSectionAccess(sectionResponse.data, actor.organizationId, studentCaseId);
  const [
    applicationsPage,
    visa,
    sections,
    handoff,
    handoffAcknowledgement,
    profileFields,
    studentApplication,
  ] = await Promise.all([
    listPlatformApplicationsForStudentCase(actor, studentCaseId, { pageSize: 100 }),
    getPlatformCaseVisa(actor, studentCaseId),
    readCaseProfileSections(access, {
      finance: () => getPlatformCaseFinanceControl(actor, studentCaseId),
      studentProfile: () => getPlatformStudentProfile(actor, studentCaseId),
      documents: () => getPlatformCaseDocumentWorkspace(actor, studentCaseId),
      contract: () => getPlatformCaseContractWorkspace(actor, studentCaseId),
    }),
    getPlatformStudentCaseHandoffContext(actor, studentCaseId),
    getHandoffAcknowledgement(actor, studentCaseId),
    access.studentProfile && staffHasPermission(actor, "profile.read.full")
      ? getPlatformStudentProfileFields(actor, studentCaseId)
      : null,
    access.studentProfile && staffHasPermission(actor, "profile.read.full")
      ? loadStudentApplicationForCase(studentCaseId)
      : null,
  ]);
  const { documents, contract } = sections;
  if (applicationsPage.hasNext) {
    throw new Error("V3 profile application list exceeds its canonical read window.");
  }
  if (documents && (documents.studentCaseId !== studentCaseId || documents.caseState !== studentCase.state)) {
    throw new Error("V3 profile document workspace does not match the requested case.");
  }
  if (
    access.contract && (!contract ||
    contract.studentCaseId !== studentCaseId ||
    contract.organizationId !== actor.organizationId)
  ) {
    throw new Error("V3 profile contract workspace does not match the requested case.");
  }
  if (
    handoff && (handoff.studentCaseId !== studentCaseId ||
    handoff.organizationId !== actor.organizationId)
  ) {
    throw new Error("V3 profile handoff context does not match the requested case.");
  }
  return {
    ...sections,
    profileFields,
    studentApplication,
    studentCase,
    applications: applicationsPage.rows,
    visa,
    handoff,
    handoffAcknowledgement,
  };
}

function financeStopText(finance: PlatformCaseFinanceControl | null): string | null {
  const stops = finance?.obligations.flatMap((obligation) => obligation.activeStopFactors) ?? [];
  return stops.length > 0 ? stops.map((item) => item.reason).join("; ") : null;
}

function fullCaseDetails(
  actor: ActivePlatformActor,
  data: FullCaseData,
  routeTarget: ProfileRouteTarget,
  responsible: string | null,
  contractSignedAt: string | null,
  isCabinetCase: boolean,
): ProfileDraft {
  const facts = profileFacts(data.studentCase, data.studentProfile);
  const money = financeSummary(data.finance);
  const canUpload = data.studentCase.state === "active"
    && !isStaffPreview(actor) && staffHasPermission(actor, "document.upload");
  const contractWorkspace = isStaffPreview(actor) && data.contract
    ? Object.freeze({
        ...data.contract,
        canManageTemplates: false,
        canGenerateContract: false,
        canReviewContract: false,
        canManagePostContract: false,
        canReviewReport: false,
      })
    : data.contract;
  const contract: ProfileContractSnapshot | null = contractWorkspace ? Object.freeze({
    workspace: contractWorkspace,
    handoff: data.handoff,
  }) : null;
  return {
    access: data.access,
    profileFields: isStaffPreview(actor) && data.profileFields
      ? { ...data.profileFields, canInitialize: false, canReview: false, canExport: false }
      : data.profileFields,
    profileFieldSources: profileFieldSourceVersions(data.documents, data.profileFields, isStaffPreview(actor)),
    studentApplication: data.studentApplication,
    routeTarget,
    responsible,
    provider: null,
    ...facts,
    documents: data.documents ? profileDocuments(
      data.documents,
      canUpload,
      data.applications,
      data.visa,
      canUpload && !isStaffPreview(actor),
    ) : [],
    otherFiles: [],
    ...money,
    admissions: admissionsWorkspace(data, isCabinetCase),
    contract,
    handoffAcknowledgement: {
      ...data.handoffAcknowledgement,
      canRespond: !isStaffPreview(actor) && data.handoffAcknowledgement.canRespond,
      requestId: randomUUID(),
    },
    salesHandoffAcknowledgement: null,
    // «Условия продажи» is a lead-card block (plan §5); this branch has no
    // lead link to attach it to (docs-intake origin or insufficient
    // sales.read), so it stays null here — see readLeadProfile below.
    saleConditions: null,
    // Same scoping as saleConditions above: a full case already exists by
    // definition on this branch, so there is nothing left to "prepare".
    leadCabinetCase: null,
    contractSignedAt,
  };
}

function caseTimeline(studentCase: PlatformStudentCaseSnapshot): PersonProfile["timeline"] {
  return studentCase.handoff
    ? [{
        id: studentCase.handoff.studentCaseOpHandoffId,
        transition: "handoff.handed_off",
        role: studentCase.handoff.responsibleRole,
        at: formatDate(studentCase.handoff.createdAt, true) ?? studentCase.handoff.createdAt,
      }]
    : [];
}

async function readCaseProfile(
  actor: ActivePlatformActor,
  studentCaseId: string,
): Promise<V3ProfileCoreView | null> {
  if (!staffPresentationCan(actor, "admissions.read")) {
    return null;
  }
  const view = await getPlatformStudentCaseView(actor, studentCaseId);
  if (view === null || view.access !== "full") return null;

  const canonicalCaseId = view.studentCase.studentCaseId;
  const links = await listPlatformStudentCaseLeadLinks(actor, [canonicalCaseId]);
  const link = links.find((item) => item.studentCaseId === canonicalCaseId) ?? null;

  if (staffPresentationCan(actor, "sales.read") && link) {
    const leadProfile = await readLeadProfile(
      actor,
      link.leadId,
      { leadId: null, studentCaseId: canonicalCaseId },
      canonicalCaseId,
    );
    if (leadProfile) return leadProfile;
  }

  const data = await loadFullCase(actor, view.studentCase);
  if (link && data.handoff?.leadId !== link.leadId) {
    throw new Error("V3 profile handoff lead does not match the canonical case link.");
  }
  // S8: only a 'pending' case can ever be cabinet_pending (184's shape) —
  // skip the extra read for active/closed cases, where it can never matter.
  const isCabinetCase = data.studentCase.state === "pending"
    ? await readStudentCaseCabinetOrigin(actor, canonicalCaseId)
    : false;
  const profile: PersonProfile = {
    leadId: link?.leadId ?? null,
    person: data.studentCase.studentDisplayName,
    email: null,
    phone: null,
    student: true,
    stage: null,
    caseStatus: data.studentCase.state,
    source: null,
    qualification: null,
    arrived: formatDate(data.studentCase.createdAt, true),
    nextAction: data.studentCase.nextAction,
    nextActionAt: null,
    handoff: null,
    applications: profileApplications(data.applications),
    visa: profileVisa(data.visa),
    financeStop: financeStopText(data.finance),
    timeline: caseTimeline(data.studentCase),
  };
  return {
    profile,
    details: {
      ...fullCaseDetails(
        actor,
        data,
        { leadId: null, studentCaseId: canonicalCaseId },
        data.studentCase.currentCuratorDisplayName,
        null,
        isCabinetCase,
      ),
    },
    sales: null,
  };
}

async function readLeadProfile(
  actor: ActivePlatformActor,
  leadId: string,
  routeTarget: ProfileRouteTarget,
  expectedStudentCaseId: string | null = null,
): Promise<V3ProfileCoreView | null> {
  if (!staffPresentationCan(actor, "sales.read")) return null;
  const lead = await getPlatformSalesLead(actor, leadId);
  if (lead === null) return null;

  const salesContext = await loadProfileSalesContext(
    expectedStudentCaseId === null ? "lead" : "case",
    {
      readGate: () => getPlatformLeadAdmissionsGate(actor, leadId),
      readHandoff: () => getPlatformLeadAdmissionsHandoff(actor, leadId),
    },
  );
  if (salesContext === null) return null;
  const { gate, handoff } = salesContext;
  const caseId = handoff.caseId;
  if (expectedStudentCaseId !== null && caseId !== expectedStudentCaseId) return null;
  const caseView = caseId ? await getPlatformStudentCaseView(actor, caseId) : null;
  const studentCase = caseView?.access === "full" ? caseView.studentCase : null;
  const salesCase = caseView?.access === "sales_summary" ? caseView.studentCase : null;
  const fullCase = staffPresentationCan(actor, "admissions.read") && studentCase
    ? await loadFullCase(actor, studentCase)
    : null;
  const salesHandoffAcknowledgement = !fullCase && caseId && handoff.handedOffAt
    ? await getSalesHandoffAcknowledgement(actor, leadId, caseId)
    : null;
  if (fullCase && fullCase.handoff?.leadId !== lead.leadId) {
    throw new Error("V3 profile handoff lead does not match the requested lead.");
  }
  const applications = fullCase?.applications ?? [];
  const visa = fullCase?.visa ?? null;
  const finance = fullCase?.finance ?? null;

  const profile: PersonProfile = {
    leadId: lead.leadId,
    person: lead.clientDisplayName ?? "Лид без имени",
    email: lead.clientEmail,
    phone: lead.clientPhone,
    student: caseId !== null,
    stage: lead.stageKey,
    caseStatus: studentCase?.state ?? salesCase?.state ?? handoff.caseState,
    source: lead.sourceKey,
    qualification: null,
    arrived: formatDate(lead.createdAt, true),
    nextAction: studentCase?.nextAction ?? lead.nextActionText,
    nextActionAt: formatDate(lead.nextActionDueDate),
    handoff: handoff.handedOffAt
      ? {
          at: formatDate(handoff.handedOffAt, true) ?? handoff.handedOffAt,
          contract: gate.contractConfirmed,
          payment: gate.firstPaymentConfirmedAt !== null,
          override: gate.gateState === "overridden",
        }
      : null,
    applications: profileApplications(applications),
    visa: profileVisa(visa),
    financeStop: financeStopText(finance),
    timeline: studentCase ? caseTimeline(studentCase) : [],
  };
  const money = financeSummary(finance);
  // «Доступ к платформе» (unified workflow S1): before Admissions takes over
  // a full case, the lead card still needs to show/decide the linked platform
  // анкета. staff_student_application_for_lead_v1 authorizes off the SAME
  // canonical-lead read the rest of this branch already established.
  const leadStudentApplication = fullCase ? null : await loadStudentApplicationForLead(leadId);
  // «Условия продажи» (unified workflow S2): the same card block the report
  // later reads back through platform.create_sales_report_handoff. Scoped to
  // the lead-only branch — see the null case's own comment in fullCaseDetails.
  const saleConditions = fullCase ? null : await readLeadSaleConditions(actor, leadId);
  // «Подготовить кабинет» (unified workflow S7): whether this lead already
  // has a linked case — regardless of anketa (site/WhatsApp leads never have
  // one) and regardless of admissions.read (a handed-off case the actor can't
  // fully open still means "don't show the prepare button again").
  const leadCabinetCase = fullCase ? null : await readLeadCabinetCase(actor, leadId);
  // S8: same pending-only optimization as readCaseProfile above.
  const isCabinetCase = fullCase && fullCase.studentCase.state === "pending" && caseId
    ? await readStudentCaseCabinetOrigin(actor, caseId)
    : false;
  const details: ProfileDraft = fullCase
    ? fullCaseDetails(
        actor,
        fullCase,
        routeTarget,
        lead.currentOwnerDisplayName,
        gate.contractConfirmedAt ? formatDate(gate.contractConfirmedAt, true) : null,
        isCabinetCase,
      )
    : {
        access: { documents: false, finance: false, studentProfile: false, contract: false },
        routeTarget,
        responsible: lead.currentOwnerDisplayName,
        provider: null,
        person: [],
        study: [],
        profileFields: null,
        studentApplication: leadStudentApplication,
        profileFieldSources: [],
        documents: [],
        otherFiles: [],
        ...money,
        admissions: null,
        contract: null,
        handoffAcknowledgement: null,
        salesHandoffAcknowledgement,
        saleConditions,
        leadCabinetCase,
        contractSignedAt: gate.contractConfirmedAt
          ? formatDate(gate.contractConfirmedAt, true)
          : null,
      };

  return {
    profile,
    details,
    sales: {
      lead,
      gate,
      handoff: profileSalesHandoffSnapshot(handoff, caseView, isStaffPreview(actor)),
      linkedConversations: lead.linkedConversations,
    },
  };
}

/** A bounded real switcher population; never a fixture or fallback source. */
const PROFILE_CASE_DIRECTORY_KEYS = [
  "case_before_at",
  "case_before_id",
  "case_q",
  "case_status",
  "direction",
  "curator",
  "attention",
] as const;

function singleDirectoryValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (typeof value === "string" || value === undefined) return value;
  throw new Error("invalid_profile_case_directory_query");
}

function trimmedDirectoryValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseV3ProfileCaseDirectoryParams(
  searchParams: Readonly<
    Record<string, string | readonly string[] | undefined>
  >,
): V3ProfileCaseDirectoryParams {
  const active = PROFILE_CASE_DIRECTORY_KEYS.some(
    (key) => searchParams[key] !== undefined,
  );
  try {
    const beforeAt = singleDirectoryValue(searchParams.case_before_at);
    const beforeId = singleDirectoryValue(searchParams.case_before_id);
    const query = trimmedDirectoryValue(
      singleDirectoryValue(searchParams.case_q),
    );
    const stateCandidate = trimmedDirectoryValue(
      singleDirectoryValue(searchParams.case_status),
    );
    const direction = trimmedDirectoryValue(singleDirectoryValue(searchParams.direction));
    const curatorMembershipId = trimmedDirectoryValue(singleDirectoryValue(searchParams.curator));
    const attention = trimmedDirectoryValue(singleDirectoryValue(searchParams.attention));
    if (direction && direction !== "unknown" && !(ADMISSIONS_DIRECTIONS as readonly string[]).includes(direction)) {
      throw new Error("invalid_profile_case_directory_query");
    }
    if (curatorMembershipId && !parsePlatformAdmissionsUuid(curatorMembershipId)) {
      throw new Error("invalid_profile_case_directory_query");
    }
    if (attention && !(ADMISSIONS_ATTENTION as readonly string[]).includes(attention)) {
      throw new Error("invalid_profile_case_directory_query");
    }
    if (
      stateCandidate &&
      !["pending", "active", "closed"].includes(stateCandidate)
    ) {
      throw new Error("invalid_profile_case_directory_query");
    }
    if ((beforeAt && !beforeId) || (!beforeAt && beforeId)) {
      throw new Error("invalid_profile_case_directory_query");
    }
    if (query && parsePlatformAdmissionsUuid(query) && (beforeAt || beforeId)) {
      throw new Error("invalid_profile_case_directory_query");
    }
    const cursor = beforeAt && beforeId
      ? parsePlatformAdmissionsCursor(beforeAt, beforeId)
      : null;
    if (beforeAt && beforeId && cursor === null) {
      throw new Error("invalid_profile_case_directory_query");
    }
    return Object.freeze({
      active,
      cursor,
      invalid: false,
      query,
      state: stateCandidate as PlatformStudentCaseState | undefined,
      direction: direction as AdmissionsDirection | "unknown" | undefined,
      curatorMembershipId,
      attention: attention as AdmissionsAttention | undefined,
    });
  } catch {
    return Object.freeze({ active, cursor: null, invalid: true });
  }
}

function directoryRow(
  item: PlatformStudentCasePageItem,
  leadIds: ReadonlyMap<string, string>,
  presentationRole: ActivePlatformActor["presentationRole"],
): V3ProfileCaseDirectoryRow {
  if (item.access === "sales_summary") {
    const studentCase = item.studentCase;
    return Object.freeze({
      access: "sales_summary",
      admissionsDisplayName: studentCase.assignedCuratorDisplayName,
      leadId: leadIds.get(studentCase.studentCaseId) ?? null,
      operationalStage: null,
      overdueObligationCount: null,
      overdueTaskCount: null,
      rejectedDocumentCount: null,
      responsibleSalesDisplayName: null,
      state: studentCase.state,
      studentCaseId: studentCase.studentCaseId,
      studentDisplayName: studentCase.studentDisplayName,
      targetCountry: studentCase.targetCountry,
      targetDegree: studentCase.targetDegree,
      updatedAt: studentCase.handoffAt,
      attentionFlags: [],
    });
  }
  if (presentationRole === "sales") {
    const studentCase = item.studentCase;
    return Object.freeze({
      access: "sales_summary",
      admissionsDisplayName: studentCase.currentCuratorDisplayName,
      leadId: leadIds.get(studentCase.studentCaseId) ?? null,
      operationalStage: null,
      overdueObligationCount: null,
      overdueTaskCount: null,
      rejectedDocumentCount: null,
      responsibleSalesDisplayName: null,
      state: studentCase.state,
      studentCaseId: studentCase.studentCaseId,
      studentDisplayName: studentCase.studentDisplayName,
      targetCountry: studentCase.targetCountry,
      targetDegree: studentCase.targetDegree,
      updatedAt: studentCase.handoffAt,
      attentionFlags: [],
    });
  }
  const studentCase = item.studentCase;
  return Object.freeze({
    access: item.access,
    admissionsDisplayName: studentCase.currentCuratorDisplayName,
    leadId: leadIds.get(studentCase.studentCaseId) ?? null,
    operationalStage: studentCase.operationalStage,
    admissionsDirection: studentCase.admissionsDirection ?? null,
    nextAction: studentCase.nextAction,
    nextActionDueOn: studentCase.nextActionDueOn ?? null,
    overdueObligationCount: studentCase.overdueObligationCount,
    overdueTaskCount: studentCase.overdueTaskCount,
    rejectedDocumentCount: studentCase.rejectedDocumentCount,
    responsibleSalesDisplayName: studentCase.responsibleSalesDisplayName,
    state: studentCase.state,
    studentCaseId: studentCase.studentCaseId,
    studentDisplayName: studentCase.studentDisplayName,
    targetCountry: studentCase.targetCountry,
    targetDegree: studentCase.targetDegree,
    updatedAt: studentCase.updatedAt,
    attentionFlags: studentCase.attentionFlags,
  });
}

export async function readV3ProfileCaseDirectory(
  actor: ActivePlatformActor,
  params: V3ProfileCaseDirectoryParams,
): Promise<V3ProfileCaseDirectory> {
  if (params.invalid) {
    return Object.freeze({ hasNext: false, nextCursor: null, rows: [] });
  }
  const exactStudentCaseId = params.query
    ? parsePlatformAdmissionsUuid(params.query)
    : null;
  const page = await listPlatformStudentCases(actor, {
    cursor: params.cursor,
    pageSize: 25,
    query: exactStudentCaseId ? undefined : params.query,
    state: params.state,
    studentCaseId: exactStudentCaseId ?? undefined,
    direction: params.direction,
    curatorMembershipId: params.curatorMembershipId,
    attention: params.attention,
  });
  const canReadSales = staffPresentationCan(actor, "sales.read");
  const links = canReadSales && page.rows.length > 0
    ? await listPlatformStudentCaseLeadLinks(
        actor,
        page.rows.map((item) => item.studentCase.studentCaseId),
      )
    : [];
  const leadIds = new Map(
    links.map((link) => [link.studentCaseId, link.leadId] as const),
  );
  return Object.freeze({
    hasNext: page.hasNext,
    nextCursor: page.nextCursor,
    rows: Object.freeze(
      page.rows.map((item) =>
        directoryRow(item, leadIds, actor.presentationRole)),
    ),
  });
}

/**
 * Compose one profile from exactly one canonical route identity. `id` remains
 * a Sales lead id; Admissions cases use the separate `case` query parameter.
 */
export async function readProfileTarget(
  actor: ActivePlatformActor,
  target: ProfileRouteTarget,
  noteCursor: PlatformCaseNoteCursor | null = null,
  activity?: Readonly<{ cursor: ProfileActivityCursor | null }>,
): Promise<V3ProfileView | null> {
  const subject = target.leadId !== null
    ? Object.freeze({ leadId: target.leadId, studentCaseId: null })
    : target.studentCaseId !== null
      ? Object.freeze({ leadId: null, studentCaseId: target.studentCaseId })
      : null;
  if (subject === null) {
    throw new Error("V3 profile route target is invalid.");
  }

  const core = target.leadId !== null
    ? await readLeadProfile(actor, target.leadId, target)
    : await readCaseProfile(actor, target.studentCaseId);
  if (core === null) return null;

  const caseId = core.details.admissions?.studentCaseId;
  const [page, history] = await Promise.all([
    readCaseNotes(actor, subject, { limit: 50, cursor: noteCursor }),
    activity && caseId && staffPresentationCan(actor, "admissions.read")
      ? readProfileActivity(actor, caseId, activity.cursor) : null,
  ]);
  const historyHref = (cursor: ProfileActivityCursor | null) => {
    const params = new URLSearchParams(target.leadId
      ? { id: target.leadId, tab: "history" } : { case: target.studentCaseId!, tab: "history" });
    if (cursor) {
      params.set("activity_before_at", cursor.at);
      params.set("activity_before_id", cursor.id);
    }
    return `/v3/profile?${params}`;
  };
  return Object.freeze({
    ...core,
    profile: history ? Object.freeze({
      ...core.profile, timeline: history.events,
      timelineOlderHref: history.nextCursor ? historyHref(history.nextCursor) : null,
      timelineLatestHref: activity?.cursor ? historyHref(null) : null,
    }) : core.profile,
    notes: Object.freeze({ subject, page }),
  });
}
