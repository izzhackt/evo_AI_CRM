import "server-only";

import { randomUUID } from "node:crypto";

import type {
  DocumentCaseLinkTarget,
  DocumentGroup,
} from "@/components/v3/profile/document-types";
import type {
  PersonProfile,
  ProfileAdmissionsWorkspace,
  ProfileDraft,
  ProfilePick,
  ProfileRouteTarget,
  ProfileSalesSnapshot,
} from "@/components/v3/profile/types";
import {
  getPlatformStudentCaseView,
  listPlatformApplicationsForStudentCase,
  listPlatformStudentCaseLeadLinks,
  listPlatformStudentCases,
  type PlatformApplicationQueueRow,
  type PlatformStudentCaseSnapshot,
} from "@/lib/platform-admissions";
import { getPlatformCaseVisa } from "@/lib/platform-case-operations";
import type { PlatformCaseVisa } from "@/lib/platform-case-operations-contract";
import {
  getPlatformCaseFinanceControl,
  type PlatformCaseFinanceControl,
} from "@/lib/platform-finance-control";
import {
  getPlatformCaseDocumentWorkspace,
  type PlatformCaseDocumentWorkspace,
  type PlatformDocumentSlot,
} from "@/lib/platform-private-documents";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { getPlatformSalesLead, listPlatformSalesLeads } from "@/lib/platform-sales";
import {
  getPlatformLeadAdmissionsGate,
  getPlatformLeadAdmissionsHandoff,
} from "@/lib/platform-student-handoff";
import {
  getPlatformStudentProfile,
  type PlatformStudentProfileSnapshot,
} from "@/lib/platform-student-profile";

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

export type V3ProfileView = Readonly<{
  profile: PersonProfile;
  details: ProfileDraft;
  sales: ProfileSalesSnapshot | null;
}>;

type FullCaseData = Readonly<{
  studentCase: PlatformStudentCaseSnapshot;
  applications: readonly PlatformApplicationQueueRow[];
  visa: PlatformCaseVisa | null;
  finance: PlatformCaseFinanceControl;
  studentProfile: PlatformStudentProfileSnapshot | null;
  documents: PlatformCaseDocumentWorkspace;
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
      { label: "Гражданство", value: studentProfile.citizenshipCountry },
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

function admissionsWorkspace(data: FullCaseData): ProfileAdmissionsWorkspace {
  return {
    studentCaseId: data.studentCase.studentCaseId,
    caseState: data.studentCase.state,
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
      visa: randomUUID(),
      createStops: Object.fromEntries(
        data.finance.obligations.map((obligation) => [
          obligation.paymentObligationId,
          randomUUID(),
        ]),
      ),
      resolveStops: Object.fromEntries(
        data.finance.obligations.flatMap((obligation) =>
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
  const [applicationsPage, visa, finance, studentProfile, documents] = await Promise.all([
    listPlatformApplicationsForStudentCase(actor, studentCaseId, { pageSize: 100 }),
    getPlatformCaseVisa(actor, studentCaseId),
    getPlatformCaseFinanceControl(actor, studentCaseId),
    getPlatformStudentProfile(actor, studentCaseId),
    getPlatformCaseDocumentWorkspace(actor, studentCaseId),
  ]);
  if (applicationsPage.hasNext) {
    throw new Error("V3 profile application list exceeds its canonical read window.");
  }
  if (documents.studentCaseId !== studentCaseId || documents.caseState !== studentCase.state) {
    throw new Error("V3 profile document workspace does not match the requested case.");
  }
  return {
    studentCase,
    applications: applicationsPage.rows,
    visa,
    finance,
    studentProfile,
    documents,
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
): ProfileDraft {
  const facts = profileFacts(data.studentCase, data.studentProfile);
  const money = financeSummary(data.finance);
  const canUpload = data.studentCase.state === "active"
    && (actor.presentationRole === "admin" || actor.presentationRole === "admissions");
  return {
    routeTarget,
    responsible,
    provider: null,
    ...facts,
    documents: profileDocuments(
      data.documents,
      canUpload,
      data.applications,
      data.visa,
    ),
    otherFiles: [],
    ...money,
    admissions: admissionsWorkspace(data),
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
): Promise<V3ProfileView | null> {
  if (actor.presentationRole !== "admin" && actor.presentationRole !== "admissions") {
    return null;
  }
  const view = await getPlatformStudentCaseView(actor, studentCaseId);
  if (view === null) return null;
  if (view.access !== "full") {
    throw new Error("V3 Admissions profile received a summary-only case.");
  }

  const canonicalCaseId = view.studentCase.studentCaseId;
  const links = await listPlatformStudentCaseLeadLinks(actor, [canonicalCaseId]);
  const link = links.find((item) => item.studentCaseId === canonicalCaseId) ?? null;

  if (actor.presentationRole === "admin" && link) {
    const leadProfile = await readLeadProfile(
      actor,
      link.leadId,
      { leadId: null, studentCaseId: canonicalCaseId },
      canonicalCaseId,
    );
    if (leadProfile) return leadProfile;
  }

  const data = await loadFullCase(actor, view.studentCase);
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
): Promise<V3ProfileView | null> {
  if (actor.presentationRole === "admissions") return null;
  const lead = await getPlatformSalesLead(actor, leadId);
  if (lead === null) return null;

  const [gate, handoff] = await Promise.all([
    getPlatformLeadAdmissionsGate(actor, leadId),
    getPlatformLeadAdmissionsHandoff(actor, leadId),
  ]);
  const caseId = handoff.caseId;
  if (expectedStudentCaseId !== null && caseId !== expectedStudentCaseId) return null;
  const caseView = caseId ? await getPlatformStudentCaseView(actor, caseId) : null;
  const studentCase = caseView?.access === "full" ? caseView.studentCase : null;
  const salesCase = caseView?.access === "sales_summary" ? caseView.studentCase : null;
  const fullCase = actor.presentationRole === "admin" && studentCase
    ? await loadFullCase(actor, studentCase)
    : null;
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
  const details: ProfileDraft = fullCase
    ? fullCaseDetails(
        actor,
        fullCase,
        routeTarget,
        lead.currentOwnerDisplayName,
        gate.contractConfirmedAt ? formatDate(gate.contractConfirmedAt, true) : null,
      )
    : {
        routeTarget,
        responsible: lead.currentOwnerDisplayName,
        provider: null,
        person: [],
        study: [],
        documents: [],
        otherFiles: [],
        ...money,
        admissions: null,
        contractSignedAt: gate.contractConfirmedAt
          ? formatDate(gate.contractConfirmedAt, true)
          : null,
      };

  return {
    profile,
    details,
    sales: { lead, gate, handoff },
  };
}

/** A bounded real switcher population; never a fixture or fallback source. */
export async function readProfilePicks(
  actor: ActivePlatformActor,
): Promise<readonly ProfilePick[]> {
  if (actor.presentationRole === "admissions") {
    const page = await listPlatformStudentCases(actor, { pageSize: 6 });
    return page.rows.map((item) => {
      if (item.access !== "full") {
        throw new Error("V3 Admissions profile picker received a summary-only case.");
      }
      return {
        target: { leadId: null, studentCaseId: item.studentCase.studentCaseId },
        name: item.studentCase.studentDisplayName,
        student: true,
      };
    });
  }

  const page = await listPlatformSalesLeads(actor, { pageSize: 6 });
  return page.rows.map((lead) => ({
    target: { leadId: lead.leadId, studentCaseId: null },
    name: lead.clientDisplayName ?? "Лид без имени",
    student: lead.linkedStudentCaseCount > 0,
  }));
}

/**
 * Compose one profile from exactly one canonical route identity. `id` remains
 * a Sales lead id; Admissions cases use the separate `case` query parameter.
 */
export function readProfileTarget(
  actor: ActivePlatformActor,
  target: ProfileRouteTarget,
): Promise<V3ProfileView | null> {
  if (target.leadId !== null) {
    return readLeadProfile(actor, target.leadId, target);
  }
  if (target.studentCaseId === null) {
    throw new Error("V3 profile route target is invalid.");
  }
  return readCaseProfile(actor, target.studentCaseId);
}
