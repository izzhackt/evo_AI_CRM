import "server-only";

import type {
  PersonProfile,
  ProfileDraft,
  ProfilePick,
  ProfileSalesSnapshot,
} from "@/components/v3/profile/types";
import {
  getPlatformStudentCaseView,
  listPlatformApplicationsForStudentCase,
} from "@/lib/platform-admissions";
import { getPlatformCaseVisa } from "@/lib/platform-case-operations";
import { getPlatformCaseFinanceControl } from "@/lib/platform-finance-control";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { getPlatformSalesLead, listPlatformSalesLeads } from "@/lib/platform-sales";
import {
  getPlatformLeadAdmissionsGate,
  getPlatformLeadAdmissionsHandoff,
} from "@/lib/platform-student-handoff";
import {
  getPlatformStudentProfile,
  listPlatformStudentCaseDocuments,
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
  sales: ProfileSalesSnapshot;
}>;

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

/**
 * A small, real switcher population for the V3 profile surface.
 * The canonical sales queue remains the only source; there is no fixture or
 * legacy database fallback.
 */
export async function readProfilePicks(
  actor: ActivePlatformActor,
): Promise<readonly ProfilePick[]> {
  const page = await listPlatformSalesLeads(actor, { pageSize: 6 });
  return page.rows.map((lead) => ({
    id: lead.leadId,
    name: lead.clientDisplayName ?? "Лид без имени",
    student: lead.linkedStudentCaseCount > 0,
  }));
}

/**
 * Compose one V3 person view from the already-reviewed Supabase projections.
 * Sales can read the sales record and handoff summary. Full student details
 * are read only for an Admin authority; the underlying repositories and RLS
 * remain the authorization source.
 */
export async function readProfile(
  actor: ActivePlatformActor,
  leadId: string,
): Promise<V3ProfileView | null> {
  const lead = await getPlatformSalesLead(actor, leadId);
  if (lead === null) return null;

  const [gate, handoff] = await Promise.all([
    getPlatformLeadAdmissionsGate(actor, leadId),
    getPlatformLeadAdmissionsHandoff(actor, leadId),
  ]);
  const caseId = handoff.caseId;
  const caseView = caseId
    ? await getPlatformStudentCaseView(actor, caseId)
    : null;

  const canReadFullCase = actor.authorityRole === "admin" && caseId !== null;
  const [applicationsPage, visa, finance, studentProfile, documents] =
    canReadFullCase
      ? await Promise.all([
          listPlatformApplicationsForStudentCase(actor, caseId, { pageSize: 100 }),
          getPlatformCaseVisa(actor, caseId),
          getPlatformCaseFinanceControl(actor, caseId),
          getPlatformStudentProfile(actor, caseId),
          listPlatformStudentCaseDocuments(actor, caseId),
        ])
      : [null, null, null, null, []] as const;

  const studentCase = caseView?.access === "full" ? caseView.studentCase : null;
  const salesCase = caseView?.access === "sales_summary" ? caseView.studentCase : null;
  const applications = applicationsPage?.rows ?? [];
  const financeStops = finance?.obligations.flatMap((obligation) =>
    obligation.activeStopFactors) ?? [];
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
    applications: applications.map((application) => ({
      id: application.universityApplicationId,
      institution: application.institutionName,
      program: application.programName,
      intake: application.intake ?? "не указано",
      status: application.status,
      nextAction: null,
      nextActionAt: null,
    })),
    visa: visa
      ? [{
          id: visa.visaCaseId,
          kind: "Визовое дело",
          status: visa.status,
          due: null,
          blockedReason: visa.note,
        }]
      : [],
    financeStop: financeStops.length > 0
      ? financeStops.map((item) => item.reason).join("; ")
      : null,
    timeline: [],
  };

  const details: ProfileDraft = {
    responsible: lead.currentOwnerDisplayName,
    provider: null,
    person: studentProfile
      ? [
          { label: "Дата рождения", value: studentProfile.dateOfBirth },
          { label: "Гражданство", value: studentProfile.citizenshipCountry },
          { label: "Страна проживания", value: studentProfile.residencyCountry },
          { label: "Язык общения", value: studentProfile.communicationLanguage },
          {
            label: "Участники решения",
            value: studentProfile.decisionParticipantLabels.join(", ") || null,
          },
        ]
      : [],
    study: studentProfile
      ? [
          { label: "Целевая страна", value: studentCase?.targetCountry ?? null },
          { label: "Ступень", value: studentCase?.targetDegree ?? null },
          { label: "Направление", value: studentCase?.programDirection ?? null },
          { label: "Интейк", value: studentCase?.intake ?? null },
          { label: "Текущее образование", value: studentProfile.currentEducationSummary },
          { label: "Академический профиль", value: studentProfile.academicSummary },
          { label: "Языковой профиль", value: studentProfile.languageSummary },
          { label: "Бюджет", value: studentProfile.budgetBand },
        ]
      : [],
    documents: documents.length > 0
      ? [{
          title: "Чеклист документов",
          items: documents.map((document) => ({
            id: document.documentSlotId,
            name: document.requirementLabel,
          })),
        }]
      : [],
    otherFiles: [],
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
      handoff,
    },
  };
}
