import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { Badge, Card, EmptyState, StatCard, inputCls, btnCls, btnGhostCls, labelCls, cn } from "@/components/ui";
import { AiSummary } from "@/components/AiSummary";
import { StudentProgress } from "@/components/platform/core/StudentProgress";
import {
  PlatformPilotCohortCard,
  type PlatformPilotCohortCardLabels,
} from "@/components/platform/cases/PlatformPilotCohortCard";
import {
  ContractDraftReportWorkspace,
  type ContractDraftReportActions,
  type ContractDraftReportRequestIdFor,
  type ContractDraftReportResult,
} from "./ContractDraftReportWorkspace";
import type { PlatformCaseContractWorkspace } from "@/lib/platform-contract-workflow";
import type {
  PlatformPilotWriteBoundary,
  PlatformStudentCasePilotCohort,
} from "@/lib/platform-pilot-cohort";
import {
  PLATFORM_STUDENT_PROFILE_DECISION_PARTICIPANTS_INPUT_MAX_LENGTH,
  PLATFORM_STUDENT_PROFILE_DECISION_PARTICIPANTS_INPUT_PATTERN,
  PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS,
} from "@/lib/platform-student-profile";
const selectCls = "rounded-nav border border-border-strong bg-surface-2 px-2 py-1.5 text-[12px] text-fg focus-visible:border-accent";

type EntityId = number | string;
type ServerFormAction = (formData: FormData) => void | Promise<void>;
type PresentationActor = Readonly<{ id: EntityId; role: string }>;
type PresentationContact = Readonly<{
  name: string;
  email: string | null;
  phone: string | null;
}>;
type PresentationClientSummary = Readonly<{
  access_mode: "sales_post_handoff_summary";
  id: EntityId;
  name: string;
  stage: string;
  target_country: string | null;
  target_degree: string | null;
  case_state: string;
  curator_name: string | null;
  handoff_at: string | null;
}>;
type PresentationClientFull = Readonly<{
  access_mode: "full";
  id: EntityId;
  name: string;
  email: string;
  phone: string | null;
  stage: string;
  target_country: string | null;
  target_degree: string | null;
  case_state: string;
  contract_confirmed_at: string | null;
  contract_confirmation_ref: string | null;
  portal_activated_at: string | null;
  handoff_at: string | null;
  curator_id: EntityId | null;
  curator_name: string | null;
  manager_name: string | null;
  notes: string | null;
}>;
type PresentationApplication = Readonly<{
  id: EntityId;
  university: string;
  country: string | null;
  program: string | null;
  deadline: string | null;
  status: string;
}>;
type PresentationDocument = Readonly<{
  id: EntityId;
  name: string;
  status: string;
  comment: string | null;
  connected?: boolean;
  documentVersionId?: string | null;
  reviewRequestId?: string | null;
  canReview?: boolean;
}>;
type PresentationStudentProfile = Readonly<{
  revision: number;
  preferredDisplayName: string | null;
  legalDisplayName: string | null;
  communicationLanguage: "ru" | "en" | null;
  dateOfBirth: string | null;
  citizenshipCountry: string | null;
  residencyCountry: string | null;
  currentEducationSummary: string | null;
  academicSummary: string | null;
  languageSummary: string | null;
  budgetBand: string | null;
  decisionParticipantLabels: readonly string[];
  consentStatus: string;
  consentEvidenceRef: string | null;
  nextStep: string | null;
  appliedCountryRequirementVersionId: string | null;
  checklistVersion: number | null;
  requiredProfileFields: readonly string[];
}>;
type PresentationCountryRequirementVersion = Readonly<{
  id: string;
  checklistVersion: number;
  status: "draft" | "approved" | "retired";
  sourceCount: number;
}>;
type PresentationStudentRoute = Readonly<{
  targetCountry: string;
  targetDegree: string;
  programDirection: string | null;
  intake: string | null;
  languageAssumption: string | null;
  fundingAssumption: string | null;
  routeApprovalStatus: "draft" | "approved" | "rework";
  operationalStage: string;
  nextAction: string | null;
}>;
type PresentationVisa = Readonly<{
  id?: EntityId;
  country: string;
  status: string;
  appointment_at: string | null;
  notes: string | null;
}>;
type PresentationFinanceStop = Readonly<{
  id: EntityId;
  reason: string;
  blocked_action: string;
  next_action: string;
  owner_name: string;
  created_at: string;
  resolution_request_id?: string;
  resolution_retry?: boolean;
}>;
type PresentationPayment = Readonly<{
  id: EntityId;
  title: string;
  amount: number;
  currency: string;
  due_date: string | null;
  status: string;
  category?: "evo_service_fee" | "third_party_cost";
  next_action?: string;
  total_paid_minor?: number;
  total_refunded_minor?: number;
  outstanding_minor?: number;
  payment_confirmation_count?: number;
  last_payment_at?: string | null;
  active_stop_factors?: readonly PresentationFinanceStop[];
  stop_create_request_id?: string;
  stop_create_retry?: boolean;
  settlement_request_id?: string;
  settlement_retry?: boolean;
}>;
type PresentationFinanceHistoryEvent = Readonly<{
  id: EntityId;
  action: string;
  resource_kind: string;
  actor_name: string;
  reason: string;
  occurred_at: string;
}>;
type PresentationTask = Readonly<{
  id: EntityId;
  title: string;
  due_date: string | null;
  status: string;
  priority: string;
  assignee_name: string | null;
  assignee_membership_id?: string | null;
  student_visible?: boolean;
  task_type?: string | null;
  request_id?: string;
}>;
type PresentationUpdate = Readonly<{
  id: EntityId;
  message: string;
  author_name: string | null;
  created_at: string;
}>;
type PresentationAuditEvent = Readonly<{
  id: EntityId;
  event_type: string;
  reason: string;
  actor_name: string;
  before_curator_name: string | null;
  after_curator_name: string | null;
  occurred_at: string;
  resource_kind?: string | null;
  change_summary?: string | null;
  headline?: string | null;
}>;
type PresentationSnapshot = Readonly<{
  stageTimeline: readonly Readonly<{ stage: string; labelKey: string }>[];
  nextAction: Readonly<{
    labelKey: string;
    detail: string;
    dueDate: string | null;
  }> | null;
  manager: PresentationContact | null;
  curator: PresentationContact | null;
  documents: readonly Readonly<{ name: string; status: string }>[];
  payments: readonly Readonly<{ title: string; status: string }>[];
  visa: Readonly<{ country: string; status: string }> | null;
}>;
type PresentationActions = Readonly<{
  updateClient?: ServerFormAction;
  addApplication?: ServerFormAction;
  setApplicationStatus?: ServerFormAction;
  addDocument?: ServerFormAction;
  upsertVisa?: ServerFormAction;
  upsertPlatformVisa?: ServerFormAction;
  addPayment?: ServerFormAction;
  addPlatformPayment?: ServerFormAction;
  markPaymentPaid?: ServerFormAction;
  markPlatformPaymentPaid?: ServerFormAction;
  createPlatformFinanceStop?: ServerFormAction;
  resolvePlatformFinanceStop?: ServerFormAction;
  addTask?: ServerFormAction;
  moveTask?: ServerFormAction;
  postUpdate?: ServerFormAction;
  closeCase?: ServerFormAction;
  reopenCase?: ServerFormAction;
  changePlatformState?: ServerFormAction;
  updateStudentRoute?: ServerFormAction;
  updateStudentProfile?: ServerFormAction;
  applyCountryRequirementVersion?: ServerFormAction;
  reviewPlatformDocument?: ServerFormAction;
}>;

function connectedAuditHeadline(event: PresentationAuditEvent, t: (key: string) => string) {
  if (event.headline) return event.headline;
  const legacyLabel = (() => {
    try {
      return t(`caseEvent.${event.event_type}`);
    } catch {
      return event.event_type;
    }
  })();
  if (event.resource_kind) {
    return `${event.resource_kind} · ${legacyLabel}`;
  }
  return legacyLabel;
}

export type ClientPagePresentationData =
  | Readonly<{
      access: "summary";
      client: PresentationClientSummary;
      testId?: string;
    }>
  | Readonly<{
      access: "full";
      actor: PresentationActor;
      client: PresentationClientFull;
      applications: readonly PresentationApplication[];
      applicationPreview?: Readonly<{
        visibleCount: number;
        hasMore: boolean;
        fullListHref: string;
      }>;
      documents: readonly PresentationDocument[];
      visa: PresentationVisa | null;
      payments: readonly PresentationPayment[];
      financeHistory?: readonly PresentationFinanceHistoryEvent[];
      pilotCohort?: PlatformStudentCasePilotCohort | null;
      pilotLegacyWriteBoundary?: PlatformPilotWriteBoundary | null;
      pilotCohortUnavailable?: boolean;
      canManagePilotCohort?: boolean;
      pilotConfigurationRequestId?: string;
      pilotIncludeRequestId?: string;
      pilotExcludeRequestId?: string;
      pilotResult?: "saved" | "invalid" | "unavailable";
      tasks: readonly PresentationTask[];
      updates: readonly PresentationUpdate[];
      taskAssignees: readonly Readonly<{ id: EntityId; name: string }>[];
      taskMutationScope: "full" | "status_only";
      audit: readonly PresentationAuditEvent[];
      snapshot: PresentationSnapshot;
      stageItems: Array<{ key: string; label: string }>;
      applicationStatuses: readonly string[];
      taskColumns: readonly string[];
      taskPriorities: readonly string[];
      visaStatuses: readonly string[];
      actions: PresentationActions;
      canManageLifecycle: boolean;
      canViewCaseAudit: boolean;
      canMutatePayments: boolean;
      canMutateFinanceStops?: boolean;
      canUseAiSummary: boolean;
      sourceHint: string;
      metrics?: Readonly<{
        activeApplications: number;
        openDocuments: number;
        openTasks: number;
        pendingPayments: number;
        nextDeadline: string;
      }>;
      blocker?: Readonly<{ label: string; detail: string; href: string }> | null;
      result?: "saved" | "invalid" | "unavailable";
      lifecycleRequestId?: string;
      platformVisaRequestId?: string;
      platformVisaMutationId?: string | null;
      platformPaymentCreateRequestId?: string;
      warning?: Readonly<{ title: string; description: string }>;
      studentRoute?: PresentationStudentRoute;
      studentProfile?: PresentationStudentProfile;
      countryRequirementVersions?: readonly PresentationCountryRequirementVersion[];
      canEditStudentProfile?: boolean;
      canApplyCountryRequirements?: boolean;
      canEditStudentRoute?: boolean;
      routeRequestId?: string;
      profileRequestId?: string;
      checklistRequestId?: string;
      contractWorkspace?: PlatformCaseContractWorkspace;
      contractActions?: ContractDraftReportActions;
      contractRequestIdFor?: ContractDraftReportRequestIdFor;
      contractResult?: ContractDraftReportResult;
      contractRetrySubjectId?: string;
      connected: boolean;
      testId?: string;
    }>;

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

type StudentWorkspacePresenterProps = Readonly<{
  data: ClientPagePresentationData;
  locale: Locale;
  t: (key: string) => string;
}>;

export async function StudentWorkspacePresenter({
  data,
  locale,
  t,
}: StudentWorkspacePresenterProps) {
  const stageLabel = (stage: string) =>
    data.access === "full"
      ? data.stageItems.find((item) => item.key === stage)?.label || t(`stage.${stage}`)
      : t(`stage.${stage}`);

  if (data.access === "summary") {
    const client = data.client;
    return (
      <div data-testid={data.testId} className="space-y-5">
        <header className="rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-accent-weak text-[20px] font-semibold text-accent">
              {initials(client.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-3">{t("student360")}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="text-[22px] font-bold leading-tight text-fg">{client.name}</h1>
                <Badge value={client.stage} label={stageLabel(client.stage)} />
              </div>
            </div>
            <Link href="/clients" className={btnGhostCls}>{t("clients")}</Link>
          </div>
        </header>

        <section
          aria-labelledby="sales-handoff-summary-title"
          className="rounded-card border border-info/20 bg-info-weak p-4 text-info shadow-evo sm:p-5"
        >
          <h2 id="sales-handoff-summary-title" className="text-[15px] font-bold">
            {t("salesHandoffSummaryTitle")}
          </h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-5 text-fg-2">
            {t("salesHandoffSummaryHint")}
          </p>
        </section>

        <section className="rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [t("client"), `#${client.id}`],
              [t("stage"), stageLabel(client.stage)],
              [t("country"), client.target_country ?? "—"],
              [t("degree"), client.target_degree ?? "—"],
              [t("caseState"), t(`caseState.${client.case_state}`)],
              [t("role.admissions"), client.curator_name ?? t("notAssigned")],
              [t("handoffAt"), client.handoff_at ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-ctl bg-surface-2 p-3">
                <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-fg-3">{label}</dt>
                <dd className="mt-1 break-words text-[13px] font-semibold text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    );
  }

  const client = data.client;
  const {
    applications: apps,
    documents: docs,
    visa,
    payments,
    financeHistory = [],
    pilotCohort = null,
    pilotLegacyWriteBoundary = null,
    pilotCohortUnavailable = false,
    canManagePilotCohort = false,
    pilotConfigurationRequestId = randomUUID(),
    pilotIncludeRequestId = randomUUID(),
    pilotExcludeRequestId = randomUUID(),
    pilotResult,
    tasks,
    updates,
    taskAssignees,
    taskMutationScope,
    audit: caseAudit,
    snapshot,
    applicationStatuses: APP_STATUSES,
    taskColumns: TASK_COLUMNS,
    taskPriorities: TASK_PRIORITIES,
    visaStatuses: VISA_STATUSES,
    actions,
    canManageLifecycle,
    canViewCaseAudit,
    canMutatePayments,
    canMutateFinanceStops = false,
    studentRoute,
    studentProfile,
    countryRequirementVersions = [],
    canEditStudentProfile = false,
    canApplyCountryRequirements = false,
    canEditStudentRoute = false,
    routeRequestId,
    profileRequestId,
    checklistRequestId,
    platformVisaRequestId,
    platformVisaMutationId,
    platformPaymentCreateRequestId,
    contractWorkspace,
    contractActions,
    contractRequestIdFor,
    contractResult,
    contractRetrySubjectId,
    connected,
  } = data;
  const pilotLabels: PlatformPilotCohortCardLabels = {
    title: t("platformPilotCohortTitle"),
    hint: t("platformPilotCohortHint"),
    unavailable: t("platformPilotCohortUnavailable"),
    resultSaved: t("platformPilotCohortResultSaved"),
    resultInvalid: t("platformPilotCohortResultInvalid"),
    resultUnavailable: t("platformPilotCohortResultUnavailable"),
    status: t("platformPilotCohortStatus"),
    statusLabels: {
      outside: t("platformPilotCohortStatusOutside"),
      included: t("platformPilotCohortStatusIncluded"),
      excluded: t("platformPilotCohortStatusExcluded"),
    },
    basis: t("platformPilotCohortBasis"),
    basisLabels: {
      cutoff_rule: t("platformPilotCohortBasisCutoff"),
      manual_include: t("platformPilotCohortBasisManualInclude"),
      manual_exclude: t("platformPilotCohortBasisManualExclude"),
    },
    notApplicable: t("platformPilotCohortNotApplicable"),
    reason: t("platformPilotCohortReason"),
    provenance: t("platformPilotCohortProvenance"),
    actor: t("platformPilotCohortActor"),
    changedAt: t("platformPilotCohortChangedAt"),
    configuration: t("platformPilotCohortConfiguration"),
    configurationMissing: t("platformPilotCohortConfigurationMissing"),
    configurationState: t("platformPilotCohortConfigurationState"),
    configurationActive: t("platformPilotCohortConfigurationActive"),
    configurationPaused: t("platformPilotCohortConfigurationPaused"),
    cutoff: t("platformPilotCohortCutoff"),
    configurationVersion: t("platformPilotCohortConfigurationVersion"),
    counts: t("platformPilotCohortCounts"),
    countOutside: t("platformPilotCohortCountOutside"),
    countIncluded: t("platformPilotCohortCountIncluded"),
    countExcluded: t("platformPilotCohortCountExcluded"),
    countTotal: t("platformPilotCohortCountTotal"),
    authority: t("platformPilotCohortAuthority"),
    evoOnly: t("platformPilotCohortEvoOnly"),
    canonicalTarget: t("platformPilotCohortCanonicalTarget"),
    canonicalAllowed: t("platformPilotCohortCanonicalAllowed"),
    canonicalBlocked: t("platformPilotCohortCanonicalBlocked"),
    legacyTarget: t("platformPilotCohortLegacyTarget"),
    legacyBlocked: t("platformPilotCohortLegacyBlocked"),
    noFallback: t("platformPilotCohortNoFallback"),
    history: t("platformPilotCohortHistory"),
    historyEmpty: t("platformPilotCohortHistoryEmpty"),
    configure: t("platformPilotCohortConfigure"),
    saveConfiguration: t("platformPilotCohortSaveConfiguration"),
    include: t("platformPilotCohortInclude"),
    exclude: t("platformPilotCohortExclude"),
    manualReason: t("platformPilotCohortManualReason"),
    manualProvenance: t("platformPilotCohortManualProvenance"),
  };
  const profileLabels = {
    ru: {
      title: "Профиль студента",
      preferredName: "Предпочитаемое имя",
      legalName: "Имя по документам",
      language: "Язык общения",
      birthDate: "Дата рождения",
      citizenship: "Гражданство",
      residence: "Страна проживания",
      education: "Текущее образование",
      academic: "Академический профиль",
      languageSummary: "Языковая подготовка",
      budget: "Бюджетный диапазон",
      participants: "Участники решения",
      participantsHint: `До ${PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS} значений через запятую`,
      consent: "Статус согласия",
      consentEvidence: "Ссылка на подтверждение согласия",
      nextStep: "Следующий шаг",
      reason: "Причина изменения",
      checklist: "Версия странового чек-листа",
      noChecklist: "Не назначена",
      requiredFields: "Обязательные поля профиля",
      provenance: "Подтверждённых источников",
      applyChecklist: "Применить утверждённую версию",
      saveProfile: "Сохранить профиль",
      routeTitle: "Маршрут перед чек-листом",
      routeMissing: "Заполните страну, степень и направление программы — без полного маршрута нельзя безопасно выбрать страновой чек-лист.",
      routeReady: "Проверьте страну, степень и направление программы перед назначением неизменяемой версии чек-листа.",
      targetCountry: "Страна обучения",
      targetDegree: "Степень",
      programDirection: "Направление программы",
      saveRoute: "Сохранить маршрут",
    },
    ky: {
      title: "Студенттин профили",
      preferredName: "Колдонулуучу аты",
      legalName: "Документтеги аты",
      language: "Байланыш тили",
      birthDate: "Туулган күнү",
      citizenship: "Жарандыгы",
      residence: "Жашаган өлкөсү",
      education: "Учурдагы билими",
      academic: "Академиялык профили",
      languageSummary: "Тилдик даярдыгы",
      budget: "Бюджет аралыгы",
      participants: "Чечимге катышуучулар",
      participantsHint: `Үтүр менен бөлүнгөн ${PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS} мааниге чейин`,
      consent: "Макулдук абалы",
      consentEvidence: "Макулдукту ырастоо шилтемеси",
      nextStep: "Кийинки кадам",
      reason: "Өзгөртүүнүн себеби",
      checklist: "Өлкө чек-листинин версиясы",
      noChecklist: "Дайындалган эмес",
      requiredFields: "Профилдин милдеттүү талаалары",
      provenance: "Текшерилген булактар",
      applyChecklist: "Бекитилген версияны колдонуу",
      saveProfile: "Профилди сактоо",
      routeTitle: "Чек-листке чейинки маршрут",
      routeMissing: "Өлкөнү, даражаны жана программанын багытын толтуруңуз — толук маршрутсуз өлкө чек-листин коопсуз тандоо мүмкүн эмес.",
      routeReady: "Өзгөрбөс чек-лист версиясын дайындоодон мурда өлкөнү, даражаны жана программанын багытын текшериңиз.",
      targetCountry: "Окуу өлкөсү",
      targetDegree: "Даража",
      programDirection: "Программанын багыты",
      saveRoute: "Маршрутту сактоо",
    },
    en: {
      title: "Student profile",
      preferredName: "Preferred name",
      legalName: "Legal name",
      language: "Communication language",
      birthDate: "Date of birth",
      citizenship: "Citizenship",
      residence: "Country of residence",
      education: "Current education",
      academic: "Academic profile",
      languageSummary: "Language preparation",
      budget: "Budget band",
      participants: "Decision participants",
      participantsHint: `Up to ${PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS} comma-separated values`,
      consent: "Consent status",
      consentEvidence: "Consent evidence reference",
      nextStep: "Next step",
      reason: "Reason for change",
      checklist: "Country checklist version",
      noChecklist: "Not assigned",
      requiredFields: "Required profile fields",
      provenance: "Verified sources",
      applyChecklist: "Apply approved version",
      saveProfile: "Save profile",
      routeTitle: "Route before checklist",
      routeMissing: "Enter the country, degree, and program direction before a country checklist can be selected safely.",
      routeReady: "Confirm the country, degree, and program direction before assigning an immutable checklist version.",
      targetCountry: "Study country",
      targetDegree: "Degree",
      programDirection: "Program direction",
      saveRoute: "Save route",
    },
  }[locale];
  const financeLabels = {
    ru: {
      expected: "Ожидается",
      received: "Подтверждено получено",
      remaining: "Осталось",
      confirmations: "Подтверждений оплаты",
      lastConfirmation: "Последнее подтверждение",
      stopped: "Дальнейшая работа остановлена",
      blockedWork: "Что заблокировано",
      stopReason: "Почему остановлено",
      stopNextAction: "Как снять блокировку",
      stopOwner: "Ответственный",
      stopCreatedAt: "Стоп установлен",
      createStop: "Установить финансовый стоп",
      clearStop: "Снять финансовый стоп",
      evidence: "Ссылка на подтверждение",
      reason: "Причина решения",
      nextAction: "Что нужно сделать дальше",
      history: "История финансовых изменений",
      historyEmpty: "Финансовых изменений пока нет.",
      actions: {
        application_submission: "Подача заявки в университет",
        document_processing: "Обработка документов",
        visa_submission: "Подача на визу",
        case_progression: "Дальнейшее движение дела",
      },
      historyActions: {
        "finance.obligation.create": "Добавлен платежный этап",
        "finance.payment.record": "Оплата подтверждена сотрудником",
        "finance.stop.create": "Финансовый стоп установлен",
        "finance.stop.resolve": "Финансовый стоп снят",
      },
    },
    ky: {
      expected: "Күтүлгөн сумма",
      received: "Алынганы ырасталды",
      remaining: "Калды",
      confirmations: "Төлөм ырастоолору",
      lastConfirmation: "Акыркы ырастоо",
      stopped: "Кийинки иш токтотулду",
      blockedWork: "Кайсы иш бөгөттөлдү",
      stopReason: "Эмне үчүн токтотулду",
      stopNextAction: "Бөгөттү кантип алып салуу керек",
      stopOwner: "Жооптуу",
      stopCreatedAt: "Стоп коюлду",
      createStop: "Финансылык стоп коюу",
      clearStop: "Финансылык стопту алуу",
      evidence: "Ырастоого шилтеме",
      reason: "Чечимдин себеби",
      nextAction: "Кийинки эмне кылуу керек",
      history: "Финансылык өзгөрүүлөрдүн тарыхы",
      historyEmpty: "Финансылык өзгөрүүлөр азырынча жок.",
      actions: {
        application_submission: "Университетке арыз тапшыруу",
        document_processing: "Документтерди иштетүү",
        visa_submission: "Визага тапшыруу",
        case_progression: "Иштин кийинки жүрүшү",
      },
      historyActions: {
        "finance.obligation.create": "Төлөм этабы кошулду",
        "finance.payment.record": "Төлөм кызматкер тарабынан ырасталды",
        "finance.stop.create": "Финансылык стоп коюлду",
        "finance.stop.resolve": "Финансылык стоп алынды",
      },
    },
    en: {
      expected: "Expected",
      received: "Confirmed received",
      remaining: "Remaining",
      confirmations: "Payment confirmations",
      lastConfirmation: "Latest confirmation",
      stopped: "Downstream work is stopped",
      blockedWork: "Blocked work",
      stopReason: "Why it is stopped",
      stopNextAction: "How to clear the block",
      stopOwner: "Owner",
      stopCreatedAt: "Stop asserted",
      createStop: "Assert finance stop",
      clearStop: "Clear finance stop",
      evidence: "Evidence reference",
      reason: "Decision reason",
      nextAction: "Required next action",
      history: "Finance change history",
      historyEmpty: "No finance changes yet.",
      actions: {
        application_submission: "University application submission",
        document_processing: "Document processing",
        visa_submission: "Visa submission",
        case_progression: "Further case progression",
      },
      historyActions: {
        "finance.obligation.create": "Payment checkpoint added",
        "finance.payment.record": "Payment confirmed by staff",
        "finance.stop.create": "Finance stop asserted",
        "finance.stop.resolve": "Finance stop cleared",
      },
    },
  }[locale];
  const financeBlockedActionLabel = (value: string): string =>
    (financeLabels.actions as Readonly<Record<string, string>>)[value] ?? value;
  const financeHistoryActionLabel = (value: string): string =>
    (financeLabels.historyActions as Readonly<Record<string, string>>)[value]
      ?? value;
  const profileFieldLabels: Readonly<Record<string, string>> = {
    preferred_display_name: profileLabels.preferredName,
    legal_display_name: profileLabels.legalName,
    communication_language: profileLabels.language,
    date_of_birth: profileLabels.birthDate,
    citizenship_country: profileLabels.citizenship,
    residency_country: profileLabels.residence,
    current_education_summary: profileLabels.education,
    academic_summary: profileLabels.academic,
    language_summary: profileLabels.languageSummary,
    budget_band: profileLabels.budget,
    decision_participant_labels: profileLabels.participants,
    consent_status: profileLabels.consent,
    consent_evidence_ref: profileLabels.consentEvidence,
    next_step: profileLabels.nextStep,
  };
  const appliedCountryVersion = studentProfile?.appliedCountryRequirementVersionId
    ? countryRequirementVersions.find(
        (version) => version.id === studentProfile.appliedCountryRequirementVersionId,
      ) ?? null
    : null;
  const num = (value: number) =>
    value.toLocaleString({ ru: "ru-RU", ky: "ky-KG", en: "en-US" }[locale]);
  const contractConfirmed = Boolean(
    client.contract_confirmed_at?.trim()
    && client.contract_confirmation_ref?.trim(),
  );
  const activeApps = data.metrics?.activeApplications
    ?? apps.filter((app) => app.status === "preparing" || app.status === "submitted").length;
  const applicationsArePartial = data.applicationPreview?.hasMore ?? false;
  const applicationsFullListHref =
    data.applicationPreview?.fullListHref
    ?? `/applications?student_case_id=${client.id}`;
  const openDocuments = data.metrics?.openDocuments
    ?? docs.filter((doc) => doc.status !== "approved").length;
  const pendingPayments = data.metrics?.pendingPayments
    ?? payments.filter((payment) => payment.status !== "paid").length;
  const openTasks = data.metrics?.openTasks
    ?? tasks.filter((task) => task.status !== "done").length;
  const nextDeadline = data.metrics?.nextDeadline
    ?? apps.find((app) => app.deadline && app.status !== "enrolled" && app.status !== "rejected")?.deadline
    ?? "—";
  const stageItems = data.stageItems.map((item) => ({
    key: item.key,
    label: item.label || t(`stage.${item.key}`),
  }));
  const nextActionHref = snapshot.nextAction?.labelKey === "portalNextTask"
    ? "#tasks"
    : snapshot.nextAction?.labelKey === "portalNextDocument"
      ? "#documents"
      : snapshot.nextAction?.labelKey === "portalNextDeadline"
        ? "#applications"
        : snapshot.nextAction?.labelKey === "portalNextPayment" || snapshot.nextAction?.labelKey === "portalNextOverduePayment"
          ? "#payments"
          : snapshot.nextAction?.labelKey === "portalNextVisa"
            ? "#visa"
            : "#overview";
  const rejectedDocument = snapshot.documents.find((document) => document.status === "rejected");
  const overduePayment = snapshot.payments.find((payment) => payment.status === "overdue");
  const rejectedVisa = snapshot.visa?.status === "rejected" ? snapshot.visa : null;
  const blocker = data.blocker ?? (rejectedDocument
    ? { label: t("documents"), detail: rejectedDocument.name, href: "#documents" }
    : overduePayment
      ? { label: t("payments"), detail: overduePayment.title, href: "#payments" }
      : rejectedVisa
        ? { label: t("visaCase"), detail: rejectedVisa.country, href: "#visa" }
        : !snapshot.manager && !snapshot.curator
          ? { label: t("portalTeam"), detail: t("notAssigned"), href: "#profile" }
          : null);
  const closeCaseAction = actions.changePlatformState ?? actions.closeCase;
  const reopenCaseAction = actions.changePlatformState ?? actions.reopenCase;
  const lifecycleIdName = actions.changePlatformState ? "student_case_id" : "client_id";

  return (
    <div data-testid={data.testId} className="space-y-5">
      {data.result && (
        <section
          className={cn(
            "rounded-card border p-4 text-[13px] shadow-evo",
            data.result === "saved"
              ? "border-info/20 bg-info-weak text-info"
              : "border-danger/25 bg-danger-weak text-danger",
          )}
          role="status"
        >
          {data.result === "saved"
            ? "Изменение сохранено через аудируемую операцию EVO Platform."
            : data.result === "invalid"
              ? "Проверьте причину и доступность действия для вашей роли."
              : "Сервер не подтвердил запись. Данные не считаются изменёнными."}
        </section>
      )}
      <header className="rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-accent-weak text-[20px] font-semibold text-accent">
            {initials(client.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-3">{t("student360")}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] font-bold leading-tight text-fg">{client.name}</h1>
              <Badge value={client.stage} label={stageLabel(client.stage)} />
            </div>
            <div className="mt-1.5 break-words font-mono text-[12.5px] text-fg-3">
              {client.email}{client.phone ? `  ·  ${client.phone}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Link href="/clients" className={btnGhostCls}>{t("clients")}</Link>
            {client.phone && <a href={`tel:${client.phone}`} className={btnGhostCls}>{t("phone")}</a>}
            <a href="#updates" className={btnCls}>{t("updates")}</a>
          </div>
        </div>
      </header>

      <section
        aria-labelledby="student-source-title"
        className="flex items-start gap-3 rounded-card border border-info/20 bg-info-weak px-4 py-3.5 text-info"
      >
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden="true" />
        <div>
          <h2 id="student-source-title" className="text-[12px] font-bold uppercase tracking-[0.06em]">
            {t("operationalContext")}
          </h2>
          <p className="mt-1 max-w-4xl text-[12.5px] leading-5 text-fg-2">
            {data.sourceHint || t("studentRecordSourceHint")}
          </p>
        </div>
      </section>

      {data.warning && (
        <section className="rounded-card border border-warn/25 bg-warn-weak p-4 text-warn shadow-evo">
          <h2 className="text-[14px] font-bold">{data.warning.title}</h2>
          <p className="mt-1 text-[12.5px] leading-5 text-fg-2">{data.warning.description}</p>
        </section>
      )}

      {connected && (
        <PlatformPilotCohortCard
          cohort={pilotCohort}
          legacyWriteBoundary={pilotLegacyWriteBoundary}
          unavailable={pilotCohortUnavailable}
          canManage={canManagePilotCohort}
          configurationRequestId={pilotConfigurationRequestId}
          includeRequestId={pilotIncludeRequestId}
          excludeRequestId={pilotExcludeRequestId}
          outcome={pilotResult}
          labels={pilotLabels}
        />
      )}

      <div className="space-y-2">
        <p id="student-sections-label" className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-3">
          {t("studentSections")}
        </p>
        <nav aria-labelledby="student-sections-label" className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="flex min-w-max gap-1.5">
            {[
              ["overview", t("portalOverview")],
              ["profile", t("portalProfile")],
              ["applications", t("applications")],
              ["documents", t("documents")],
              ["visa", t("visaCase")],
              ["tasks", t("openWork")],
              ["payments", t("payments")],
              ["updates", t("updates")],
            ].map(([anchor, label]) => (
              <a
                key={anchor}
                href={`#${anchor}`}
                className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3 text-[12px] font-semibold text-fg-2 transition-colors hover:border-border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {label}
              </a>
            ))}
          </div>
        </nav>
      </div>

      <div id="overview" className="grid scroll-mt-24 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-card border border-border bg-surface p-4 shadow-evo" aria-labelledby="student-next-action">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-3">{t("portalNextAction")}</p>
              {snapshot.nextAction ? (
                <>
                  <h2 id="student-next-action" className="mt-2 text-[16px] font-bold text-fg">{t(snapshot.nextAction.labelKey)}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-fg-2">{snapshot.nextAction.detail}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-fg-3">
                      {snapshot.nextAction.dueDate ?? t("portalNoFixedDate")}
                    </span>
                    <a href={nextActionHref} className={btnGhostCls}>{t("open")}</a>
                  </div>
                </>
              ) : (
                <>
                  <h2 id="student-next-action" className="mt-2 text-[16px] font-bold text-fg">{t("portalNoNextAction")}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-fg-2">{t("portalNoNextActionHint")}</p>
                </>
              )}
            </section>

            <section
              className={cn(
                "rounded-card border p-4 shadow-evo",
                blocker ? "border-danger/25 bg-danger-weak" : "border-border bg-surface",
              )}
              aria-labelledby="student-blocker"
            >
              <p className={cn("text-[11px] font-bold uppercase tracking-[0.08em]", blocker ? "text-danger" : "text-fg-3")}>
                {t("risk")}
              </p>
              <h2 id="student-blocker" className="mt-2 text-[16px] font-bold text-fg">
                {blocker?.label ?? t("studentRiskNotRecorded")}
              </h2>
              {blocker && (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] leading-5 text-fg-2">{blocker.detail}</p>
                  <a href={blocker.href} className={btnGhostCls}>{t("open")}</a>
                </div>
              )}
            </section>
          </div>

          <section className="rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5" aria-labelledby="student-progress">
            <h2 id="student-progress" className="mb-4 text-[14px] font-bold text-fg">{t("portalProgress")}</h2>
            <StudentProgress
              stages={stageItems}
              currentStage={client.stage}
              label={t("portalProgress")}
              currentLabel={stageLabel(client.stage)}
            />
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label={t("activeApplications")}
              value={applicationsArePartial ? `≥${num(activeApps)}` : num(activeApps)}
              href="#applications"
              meta={
                applicationsArePartial
                  ? t("activeApplicationsLowerBound")
                  : undefined
              }
              tone="info"
            />
            <StatCard label={t("openDocuments")} value={num(openDocuments)} href="#documents" tone="warning" />
            <StatCard label={t("openWork")} value={num(openTasks)} href="#tasks" tone="accent" />
            <StatCard label={t("pendingPayments")} value={num(pendingPayments)} href="#payments" tone="danger" />
            <StatCard label={t("nextDeadline")} value={nextDeadline} />
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start" aria-label={t("portalTeam")}>
          <div className="rounded-card border border-border bg-surface p-4 shadow-evo">
            <h2 className="text-[14px] font-bold text-fg">{t("portalTeam")}</h2>
            <dl className="mt-3 space-y-3">
              {[
                [t("manager"), snapshot.manager],
                [t("role.admissions"), snapshot.curator],
              ].map(([role, contact]) => (
                <div key={String(role)} className="rounded-ctl bg-surface-2 p-3">
                  <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-fg-3">{String(role)}</dt>
                  <dd className="mt-1 text-[13px] font-semibold text-fg">
                    {typeof contact === "object" && contact ? contact.name : t("notAssigned")}
                  </dd>
                  {typeof contact === "object" && contact && (
                    <dd className="mt-1 break-words font-mono text-[10.5px] text-fg-3">
                      {contact.email}{contact.phone ? ` · ${contact.phone}` : ""}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4 shadow-evo">
            <h2 className="text-[14px] font-bold text-fg">{t("latestUpdates")}</h2>
            {updates.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-fg-3">{t("noUpdates")}</p>
            ) : (
              <ol className="mt-3 space-y-3 border-l border-border pl-3">
                {updates.slice(0, 3).map((update) => (
                  <li key={update.id}>
                    <p className="text-[12.5px] leading-5 text-fg">{update.message}</p>
                    <p className="mt-1 font-mono text-[10.5px] text-fg-3">
                      {update.author_name ?? "—"} · {update.created_at}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {data.canUseAiSummary && typeof client.id === "number" && (
          <div className="rounded-card border border-border bg-surface p-4 shadow-evo">
            <p className="mb-3 text-[11px] leading-4 text-fg-3">{t("studentAiSummaryHint")}</p>
            <AiSummary
              clientId={client.id}
              labels={{ button: t("aiSummary"), thinking: t("aiThinking"), notConfigured: t("aiNotConfigured") }}
            />
          </div>
          )}
        </aside>
      </div>

      <section id="case-lifecycle" className="scroll-mt-24">
        <Card title={t("studentCaseLifecycle")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-nav border border-border bg-surface-2 p-3">
              <p className="text-[11px] text-fg-3">{t("caseState")}</p>
              <div className="mt-2">
                <Badge value={client.case_state} label={t(`caseState.${client.case_state}`)} />
              </div>
            </div>
            <div className="rounded-nav border border-border bg-surface-2 p-3">
              <p className="text-[11px] text-fg-3">{t("contractConfirmation")}</p>
              <p className="mt-2 text-[13px] font-semibold text-fg">
                {contractConfirmed ? t("contractConfirmed") : t("contractNotConfirmed")}
              </p>
            </div>
            <div className="rounded-nav border border-border bg-surface-2 p-3">
              <p className="text-[11px] text-fg-3">{t("handoffAt")}</p>
              <p className="mt-2 font-mono text-[11px] text-fg-2">{client.handoff_at ?? "—"}</p>
            </div>
            <div className="rounded-nav border border-border bg-surface-2 p-3">
              <p className="text-[11px] text-fg-3">{t("portalActivatedAt")}</p>
              <p className="mt-2 font-mono text-[11px] text-fg-2">{client.portal_activated_at ?? "—"}</p>
            </div>
          </div>

          {canManageLifecycle && client.case_state === "active" && closeCaseAction ? (
            <form
              action={closeCaseAction}
              data-testid="student-case-close-form"
              className="mt-4 grid gap-3 rounded-nav border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_auto] sm:items-end"
            >
              <input type="hidden" name={lifecycleIdName} value={client.id} />
              {actions.changePlatformState && (
                <>
                  <input type="hidden" name="request_id" value={data.lifecycleRequestId} />
                  <input type="hidden" name="new_state" value="closed" />
                </>
              )}
              <label className={labelCls}>
                {t("closeCaseReason")}
                <textarea
                  name="reason"
                  required
                  maxLength={1000}
                  rows={2}
                  className={cn(inputCls, "mt-1 resize-y py-2")}
                />
              </label>
              <button type="submit" className={btnGhostCls}>{t("closeStudentCase")}</button>
            </form>
          ) : null}

          {canManageLifecycle && client.case_state === "closed" && reopenCaseAction ? (
            <form
              action={reopenCaseAction}
              data-testid="student-case-reopen-form"
              className="mt-4 grid gap-3 rounded-nav border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_auto] sm:items-end"
            >
              <input type="hidden" name={lifecycleIdName} value={client.id} />
              {actions.changePlatformState && (
                <>
                  <input type="hidden" name="request_id" value={data.lifecycleRequestId} />
                  <input type="hidden" name="new_state" value="active" />
                </>
              )}
              <label className={labelCls}>
                {t("reopenCaseReason")}
                <textarea
                  name="reason"
                  required
                  maxLength={1000}
                  rows={2}
                  className={cn(inputCls, "mt-1 resize-y py-2")}
                />
              </label>
              <button type="submit" className={btnGhostCls}>{t("reopenStudentCase")}</button>
            </form>
          ) : null}

          {canViewCaseAudit ? (
            <div className="mt-4 rounded-nav border border-border bg-surface-2 p-3">
              <p className="text-[13px] font-semibold text-fg">{t("studentCaseAudit")}</p>
              {caseAudit.length === 0 ? (
                <p className="mt-2 text-[12px] text-fg-3">{t("caseAuditEmpty")}</p>
              ) : (
                <ol className="mt-3 space-y-3 border-l border-border pl-3">
                  {caseAudit.map((event) => (
                    <li key={event.id}>
                      <p className="text-[12.5px] font-medium text-fg">
                        {connectedAuditHeadline(event, t)}
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-fg-2">
                        {event.change_summary ?? event.reason}
                      </p>
                      {event.before_curator_name !== null || event.after_curator_name !== null ? (
                        <p className="mt-1 text-[11px] text-fg-3">
                          {event.actor_name} · {event.before_curator_name ?? "—"} → {event.after_curator_name ?? "—"}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-fg-3">{event.actor_name}</p>
                      )}
                      <p className="mt-1 font-mono text-[10.5px] text-fg-3">{event.occurred_at}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </Card>
      </section>

      {/* Profile */}
      <section id="profile" className="scroll-mt-24">
        <Card title={studentProfile ? profileLabels.title : t("client")}>
        {studentProfile ? (
          <div className="space-y-4">
            {studentRoute
              && !studentProfile.appliedCountryRequirementVersionId
              && canEditStudentRoute
              && actions.updateStudentRoute && (
              <div
                data-testid="platform-student-route-gate"
                className="rounded-nav border border-border-strong bg-surface-2 p-3"
              >
                <p className="text-[13px] font-semibold text-fg">{profileLabels.routeTitle}</p>
                <p className="mt-1 text-[12px] leading-5 text-fg-2">
                  {studentRoute.programDirection
                    ? profileLabels.routeReady
                    : profileLabels.routeMissing}
                </p>
                <form
                  action={actions.updateStudentRoute}
                  className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  <input type="hidden" name="student_case_id" value={client.id} />
                  {routeRequestId && <input type="hidden" name="request_id" value={routeRequestId} />}
                  <input type="hidden" name="intake" value={studentRoute.intake ?? ""} />
                  <input type="hidden" name="language_assumption" value={studentRoute.languageAssumption ?? ""} />
                  <input type="hidden" name="funding_assumption" value={studentRoute.fundingAssumption ?? ""} />
                  <input type="hidden" name="operational_stage" value={studentRoute.operationalStage} />
                  <input type="hidden" name="next_action" value={studentRoute.nextAction ?? ""} />
                  <label className={labelCls}>
                    {profileLabels.targetCountry}
                    <input
                      name="target_country"
                      required
                      maxLength={120}
                      defaultValue={studentRoute.targetCountry}
                      className={cn(inputCls, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    {profileLabels.targetDegree}
                    <input
                      name="target_degree"
                      required
                      maxLength={160}
                      defaultValue={studentRoute.targetDegree}
                      className={cn(inputCls, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    {profileLabels.programDirection}
                    <input
                      name="program_direction"
                      required
                      maxLength={200}
                      defaultValue={studentRoute.programDirection ?? ""}
                      className={cn(inputCls, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    {profileLabels.reason}
                    <input
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      className={cn(inputCls, "mt-1")}
                    />
                  </label>
                  <div className="flex items-end">
                    <button type="submit" className={btnGhostCls}>{profileLabels.saveRoute}</button>
                  </div>
                </form>
              </div>
            )}
            {canEditStudentProfile && actions.updateStudentProfile ? (
              <form
                action={actions.updateStudentProfile}
                data-testid="platform-student-profile-form"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                <input type="hidden" name="student_case_id" value={client.id} />
                <input type="hidden" name="expected_revision" value={studentProfile.revision} />
                {profileRequestId && <input type="hidden" name="request_id" value={profileRequestId} />}
                <label className={labelCls}>
                  {profileLabels.preferredName}
                  <input
                    name="preferred_display_name"
                    required
                    maxLength={160}
                    defaultValue={studentProfile.preferredDisplayName ?? ""}
                    className={cn(inputCls, "mt-1")}
                  />
                </label>
                {studentProfile.requiredProfileFields.includes("legal_display_name") && (
                  <label className={labelCls}>
                    {profileLabels.legalName}
                    <input
                      name="legal_display_name"
                      required
                      maxLength={200}
                      defaultValue={studentProfile.legalDisplayName ?? ""}
                      className={cn(inputCls, "mt-1")}
                    />
                  </label>
                )}
                <label className={labelCls}>
                  {profileLabels.language}
                  <select
                    name="communication_language"
                    required
                    defaultValue={studentProfile.communicationLanguage ?? ""}
                    className={cn(inputCls, "mt-1")}
                  >
                    <option value="">—</option>
                    <option value="ru">RU</option>
                    <option value="en">EN</option>
                  </select>
                </label>
                {studentProfile.requiredProfileFields.includes("date_of_birth") && (
                  <label className={labelCls}>
                    {profileLabels.birthDate}
                    <input
                      name="date_of_birth"
                      type="date"
                      required
                      defaultValue={studentProfile.dateOfBirth ?? ""}
                      className={cn(inputCls, "mt-1 font-mono")}
                    />
                  </label>
                )}
                <label className={labelCls}>
                  {profileLabels.citizenship}
                  <input
                    name="citizenship_country"
                    required
                    maxLength={120}
                    defaultValue={studentProfile.citizenshipCountry ?? ""}
                    className={cn(inputCls, "mt-1")}
                  />
                </label>
                <label className={labelCls}>
                  {profileLabels.residence}
                  <input
                    name="residency_country"
                    required
                    maxLength={120}
                    defaultValue={studentProfile.residencyCountry ?? ""}
                    className={cn(inputCls, "mt-1")}
                  />
                </label>
                <label className={labelCls}>
                  {profileLabels.budget}
                  <input
                    name="budget_band"
                    required
                    maxLength={120}
                    defaultValue={studentProfile.budgetBand ?? ""}
                    className={cn(inputCls, "mt-1")}
                  />
                </label>
                <label className={labelCls}>
                  {profileLabels.consent}
                  <select
                    name="consent_status"
                    defaultValue={studentProfile.consentStatus}
                    className={cn(inputCls, "mt-1")}
                  >
                    <option value="not_recorded">not_recorded</option>
                    <option value="granted">granted</option>
                    <option value="withdrawn">withdrawn</option>
                  </select>
                </label>
                <label className={labelCls}>
                  {profileLabels.consentEvidence}
                  <input
                    name="consent_evidence_ref"
                    required={studentProfile.requiredProfileFields.includes("consent_evidence_ref")}
                    maxLength={512}
                    defaultValue={studentProfile.consentEvidenceRef ?? ""}
                    className={cn(inputCls, "mt-1")}
                  />
                </label>
                <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
                  {profileLabels.education}
                  <textarea
                    name="current_education_summary"
                    required
                    maxLength={2000}
                    defaultValue={studentProfile.currentEducationSummary ?? ""}
                    rows={2}
                    className={cn(inputCls, "mt-1 resize-y py-2")}
                  />
                </label>
                <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
                  {profileLabels.academic}
                  <textarea
                    name="academic_summary"
                    required
                    maxLength={2000}
                    defaultValue={studentProfile.academicSummary ?? ""}
                    rows={2}
                    className={cn(inputCls, "mt-1 resize-y py-2")}
                  />
                </label>
                <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
                  {profileLabels.languageSummary}
                  <textarea
                    name="language_summary"
                    required
                    maxLength={2000}
                    defaultValue={studentProfile.languageSummary ?? ""}
                    rows={2}
                    className={cn(inputCls, "mt-1 resize-y py-2")}
                  />
                </label>
                <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
                  {profileLabels.participants}
                  <input
                    name="decision_participant_labels"
                    required={studentProfile.requiredProfileFields.includes("decision_participant_labels")}
                    maxLength={PLATFORM_STUDENT_PROFILE_DECISION_PARTICIPANTS_INPUT_MAX_LENGTH}
                    pattern={PLATFORM_STUDENT_PROFILE_DECISION_PARTICIPANTS_INPUT_PATTERN}
                    aria-describedby="platform-decision-participants-hint"
                    defaultValue={studentProfile.decisionParticipantLabels.join(", ")}
                    className={cn(inputCls, "mt-1")}
                  />
                  <span
                    id="platform-decision-participants-hint"
                    className="mt-1 block text-[11px] font-normal text-fg-3"
                  >
                    {profileLabels.participantsHint}
                  </span>
                </label>
                <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
                  {profileLabels.nextStep}
                  <textarea
                    name="profile_next_step"
                    required
                    maxLength={1000}
                    defaultValue={studentProfile.nextStep ?? ""}
                    rows={2}
                    className={cn(inputCls, "mt-1 resize-y py-2")}
                  />
                </label>
                <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
                  {profileLabels.reason}
                  <input name="reason" required minLength={3} maxLength={500} className={cn(inputCls, "mt-1")} />
                </label>
                <div>
                  <button type="submit" className={btnCls}>{profileLabels.saveProfile}</button>
                </div>
              </form>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  [profileLabels.preferredName, studentProfile.preferredDisplayName],
                  [profileLabels.legalName, studentProfile.legalDisplayName],
                  [profileLabels.language, studentProfile.communicationLanguage?.toUpperCase() ?? null],
                  [profileLabels.birthDate, studentProfile.dateOfBirth],
                  [profileLabels.citizenship, studentProfile.citizenshipCountry],
                  [profileLabels.residence, studentProfile.residencyCountry],
                  [profileLabels.education, studentProfile.currentEducationSummary],
                  [profileLabels.academic, studentProfile.academicSummary],
                  [profileLabels.languageSummary, studentProfile.languageSummary],
                  [profileLabels.budget, studentProfile.budgetBand],
                  [profileLabels.participants, studentProfile.decisionParticipantLabels.join(", ")],
                  [profileLabels.consent, studentProfile.consentStatus],
                  [profileLabels.nextStep, studentProfile.nextStep],
                ].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, value]) => (
                  <div key={label} className="rounded-nav border border-border bg-surface-2 p-3">
                    <dt className={labelCls}>{label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-[13px] font-medium text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="border-t border-border pt-4" data-testid="platform-country-checklist">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className={labelCls}>{profileLabels.checklist}</p>
                  <p className="mt-1 text-[13.5px] font-semibold text-fg">
                    {studentProfile.checklistVersion === null
                      ? profileLabels.noChecklist
                      : `v${studentProfile.checklistVersion}`}
                  </p>
                  <p className="mt-2 text-[11.5px] text-fg-3">
                    {profileLabels.requiredFields}: {studentProfile.requiredProfileFields
                      .map((field) => profileFieldLabels[field] ?? field)
                      .join(", ") || "—"}
                  </p>
                  {appliedCountryVersion && (
                    <p className="mt-1 text-[11.5px] text-fg-3">
                      {profileLabels.provenance}: {appliedCountryVersion.sourceCount}
                    </p>
                  )}
                </div>
                {canApplyCountryRequirements
                  && !studentProfile.appliedCountryRequirementVersionId
                  && actions.applyCountryRequirementVersion && (
                  <form action={actions.applyCountryRequirementVersion} className="flex w-full flex-col gap-2 sm:max-w-sm">
                    <input type="hidden" name="student_case_id" value={client.id} />
                    {checklistRequestId && <input type="hidden" name="request_id" value={checklistRequestId} />}
                    <label className={labelCls}>
                      {profileLabels.applyChecklist}
                      <select name="country_requirement_version_id" required className={cn(inputCls, "mt-1")}>
                        <option value="">—</option>
                        {countryRequirementVersions
                          .filter((version) => version.status === "approved")
                          .map((version) => (
                            <option key={version.id} value={version.id}>
                              v{version.checklistVersion} · {profileLabels.provenance}: {version.sourceCount}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className={labelCls}>
                      {profileLabels.reason}
                      <input name="reason" required minLength={3} maxLength={500} className={cn(inputCls, "mt-1")} />
                    </label>
                    <button type="submit" className={btnGhostCls}>{profileLabels.applyChecklist}</button>
                  </form>
                )}
              </div>
            </div>
          </div>
        ) : actions.updateClient ? (
        <form
          action={actions.updateClient}
          data-testid="client-profile-form"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <input type="hidden" name="client_id" value={client.id} />
          <label className={labelCls}>
            {t("stage")}
            <select name="stage" defaultValue={client.stage} className={cn(inputCls, "mt-1")}>
              {stageItems.filter((stage) => stage.key !== "archived").map((stage) => (
                <option key={stage.key} value={stage.key}>{stage.label}</option>
              ))}
            </select>
          </label>
          <div className="rounded-nav border border-border bg-surface-2 p-3">
            <p className={labelCls}>{t("manager")}</p>
            <p className="mt-1 text-[13px] font-medium text-fg">{client.manager_name ?? t("notAssigned")}</p>
            <p className="mt-1 text-[10.5px] leading-4 text-fg-3">{t("managerReadOnlyHint")}</p>
          </div>
          <div className="rounded-nav border border-border bg-surface-2 p-3">
            <p className={labelCls}>{t("role.admissions")}</p>
            <p className="mt-1 text-[13px] font-medium text-fg">{client.curator_name ?? t("notAssigned")}</p>
            <p className="mt-1 text-[10.5px] leading-4 text-fg-3">{t("admissionsOwnerReadOnlyHint")}</p>
          </div>
          <label className={labelCls}>
            {t("country")}
            <input name="target_country" defaultValue={client.target_country ?? ""} className={cn(inputCls, "mt-1")} />
          </label>
          <label className={labelCls}>
            {t("degree")}
            <input name="target_degree" defaultValue={client.target_degree ?? ""} className={cn(inputCls, "mt-1")} />
          </label>
          <label className={cn(labelCls, "sm:col-span-2 lg:col-span-3")}>
            {t("notes")}
            <textarea name="notes" defaultValue={client.notes ?? ""} rows={2} className={cn(inputCls, "mt-1 resize-y py-2")} />
          </label>
          <div><button type="submit" className={btnCls}>{t("save")}</button></div>
        </form>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [t("stage"), stageLabel(client.stage)],
              [t("manager"), client.manager_name ?? t("notAssigned")],
              [t("role.admissions"), client.curator_name ?? t("notAssigned")],
              [t("country"), client.target_country ?? "—"],
              [t("degree"), client.target_degree ?? "—"],
              [t("notes"), client.notes ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-nav border border-border bg-surface-2 p-3">
                <dt className={labelCls}>{label}</dt>
                <dd className="mt-1 text-[13px] font-medium text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        </Card>
      </section>

      {contractWorkspace && contractActions && contractRequestIdFor ? (
        <ContractDraftReportWorkspace
          workspace={contractWorkspace}
          actions={contractActions}
          requestIdFor={contractRequestIdFor}
          result={contractResult}
          retrySubjectId={contractRetrySubjectId}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Applications */}
        <section id="applications" className="min-w-0 scroll-mt-24">
          <Card title={t("applications")}>
          {applicationsArePartial ? (
            <div
              role="note"
              data-testid="platform-application-preview-partial"
              className="mb-3 rounded-nav border border-info/30 bg-info-weak px-3 py-2.5 text-[12px] leading-5 text-fg-2"
            >
              {t("applicationsPreviewPartial")}{" "}
              <span className="font-mono font-semibold text-fg">
                {num(data.applicationPreview?.visibleCount ?? apps.length)}
              </span>
              .
            </div>
          ) : null}
          <ul className="divide-y divide-border">
            {apps.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-fg">{a.university}</div>
                  <div className="text-[12px] text-fg-3">
                    {[a.program, a.country, a.deadline ? `${t("deadline")}: ${a.deadline}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {actions.setApplicationStatus ? (
                <form
                  action={actions.setApplicationStatus}
                  className="grid w-full gap-2 rounded-ctl border border-border bg-surface-2 p-2 sm:w-80"
                  data-testid={`platform-case-application-status-form-${a.id}`}
                >
                  {connected ? (
                    <>
                      <input type="hidden" name="application_id" value={a.id} />
                      <input type="hidden" name="student_case_id" value={client.id} />
                      <input type="hidden" name="request_id" value={randomUUID()} />
                      <input type="hidden" name="return_to_case" value="1" />
                    </>
                  ) : (
                    <>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="client_id" value={client.id} />
                    </>
                  )}
                  <label className={cn(labelCls, "mb-0")}>
                    {t("status")}
                    <select name="status" defaultValue={a.status} className={cn(selectCls, "mt-1 w-full")}>
                      {APP_STATUSES.map((s) => (
                        <option key={s} value={s}>{t(`app.${s}`)}</option>
                      ))}
                    </select>
                  </label>
                  {connected ? (
                    <>
                      <label className={cn(labelCls, "mb-0")}>
                        {t("platformDecisionEvidenceRef")}
                        <input name="evidence_reference" autoComplete="off" className={cn(inputCls, "mt-1")} />
                      </label>
                      <label className={cn(labelCls, "mb-0")}>
                        {t("notes")}
                        <input name="note" className={cn(inputCls, "mt-1")} />
                      </label>
                    </>
                  ) : null}
                  <button type="submit" className={btnGhostCls}>{t("save")}</button>
                </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge value={a.status} label={a.status} />
                    <Link href={`/applications/${a.id}`} className={btnGhostCls}>{t("open")}</Link>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {apps.length === 0 && <EmptyState text={t("noResults")} />}
          <div className="mt-3 border-t border-border pt-3">
            <Link
              href={applicationsFullListHref}
              className={btnGhostCls}
            >
              {t("applicationsFullList")} →
            </Link>
          </div>
          {actions.addApplication ? (
          <details className="mt-3 border-t border-border pt-3">
            <summary className={cn(btnGhostCls, "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
              + {t("addApplication")}
            </summary>
            <form
              action={actions.addApplication}
              className="mt-3 grid gap-2 sm:grid-cols-2"
              data-testid="platform-case-application-create-form"
            >
              {connected ? (
                <>
                  <input type="hidden" name="student_case_id" value={client.id} />
                  <input type="hidden" name="request_id" value={randomUUID()} />
                  <input type="hidden" name="return_to_case" value="1" />
                </>
              ) : (
                <input type="hidden" name="client_id" value={client.id} />
              )}
              <label className={cn(labelCls, "mb-0")}>
                {t("university")}
                <input
                  name={connected ? "institution_name" : "university"}
                  required
                  placeholder={t("university")}
                  className={cn(inputCls, "mt-1")}
                />
              </label>
              <label className={cn(labelCls, "mb-0")}>
                {t("program")}
                <input
                  name={connected ? "program_name" : "program"}
                  required={connected}
                  placeholder={t("program")}
                  className={cn(inputCls, "mt-1")}
                />
              </label>
              {connected ? (
                <>
                  <label className={cn(labelCls, "mb-0")}>
                    {t("status")}
                    <select name="status" defaultValue="preparation" className={cn(inputCls, "mt-1")}>
                      {APP_STATUSES.map((status) => (
                        <option key={status} value={status}>{t(`app.${status}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className={cn(labelCls, "mb-0")}>
                    {t("platformDecisionEvidenceRef")}
                    <input name="evidence_reference" autoComplete="off" className={cn(inputCls, "mt-1")} />
                  </label>
                  <label className={cn(labelCls, "mb-0 sm:col-span-2")}>
                    {t("notes")}
                    <input name="note" className={cn(inputCls, "mt-1")} />
                  </label>
                </>
              ) : (
                <>
                  <label className={cn(labelCls, "mb-0")}>
                    {t("degree")}
                    <input name="degree" placeholder={t("degree")} className={cn(inputCls, "mt-1")} />
                  </label>
                  <label className={cn(labelCls, "mb-0")}>
                    {t("country")}
                    <input name="country" placeholder={t("country")} className={cn(inputCls, "mt-1")} />
                  </label>
                  <label className={cn(labelCls, "mb-0")}>
                    {t("deadline")}
                    <input name="deadline" type="date" className={cn(inputCls, "mt-1 font-mono")} />
                  </label>
                </>
              )}
              <button type="submit" className={cn(btnCls, "sm:col-span-2")}>+ {t("addApplication")}</button>
            </form>
          </details>
          ) : (
            <div className="mt-3 border-t border-border pt-3">
              <Link href="/applications#add" className={btnGhostCls}>+ {t("addApplication")}</Link>
            </div>
          )}
          </Card>
        </section>

        {/* Documents */}
        <section id="documents" className="min-w-0 scroll-mt-24">
          <Card title={t("documents")}>
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {d.connected === false ? (
                    <span className="break-words text-[13.5px] font-semibold text-fg">{d.name}</span>
                  ) : (
                    <Link href={`/documents/${d.id}`} className="break-words text-[13.5px] font-semibold text-fg hover:text-accent">
                      {d.name}
                    </Link>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge value={d.status} label={t(`doc.${d.status}`)} />
                    {d.comment && <span className="text-[11.5px] leading-4 text-danger">{d.comment}</span>}
                  </div>
                </div>
                {d.connected !== false && (
                  <Link href={`/documents/${d.id}`} className={cn(btnGhostCls, "w-full shrink-0 sm:w-auto")}>
                    {t("documentDetail")}
                  </Link>
                )}
                {d.connected === false &&
                  d.canReview &&
                  d.documentVersionId &&
                  d.reviewRequestId &&
                  actions.reviewPlatformDocument && (
                    <form
                      action={actions.reviewPlatformDocument}
                      className="grid w-full gap-2 rounded-nav border border-border bg-surface-2 p-3 sm:max-w-md sm:grid-cols-2"
                      data-testid="platform-document-review-form"
                    >
                      <input type="hidden" name="student_case_id" value={client.id} />
                      <input
                        type="hidden"
                        name="document_version_id"
                        value={d.documentVersionId}
                      />
                      <input
                        type="hidden"
                        name="request_id"
                        value={d.reviewRequestId}
                      />
                      <label className={labelCls}>
                        {t("status")}
                        <select
                          name="decision"
                          defaultValue="correction_required"
                          className={cn(selectCls, "mt-1 w-full")}
                        >
                          <option value="approved">{t("doc.approved")}</option>
                          <option value="correction_required">
                            {t("correctionRequired")}
                          </option>
                          <option value="rejected">{t("doc.rejected")}</option>
                        </select>
                      </label>
                      <label className={labelCls}>
                        {t("platformReviewReason")}
                        <input
                          type="text"
                          name="reason"
                          required
                          minLength={1}
                          maxLength={2000}
                          className={cn(inputCls, "mt-1 w-full")}
                        />
                      </label>
                      <button
                        type="submit"
                        className={cn(btnCls, "sm:col-span-2")}
                        data-testid="platform-document-review-submit"
                      >
                        {t("save")}
                      </button>
                    </form>
                  )}
              </li>
            ))}
          </ul>
          {docs.length === 0 && <EmptyState text={t("noResults")} />}
          {actions.addDocument && (
          <details className="mt-3 border-t border-border pt-3">
            <summary className={cn(btnGhostCls, "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
              + {t("addDocument")}
            </summary>
            <form action={actions.addDocument} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <input type="hidden" name="client_id" value={client.id} />
              <label className={cn(labelCls, "mb-0 min-w-0 flex-1")}>
                {t("document")}
                <input name="name" required placeholder={t("document")} className={cn(inputCls, "mt-1")} />
              </label>
              <button type="submit" className={btnCls}>+ {t("addDocument")}</button>
            </form>
          </details>
          )}
          </Card>
        </section>

        {/* Visa */}
        <section id="visa" className="min-w-0 scroll-mt-24">
          <Card title={t("visaCase")}>
          {actions.upsertPlatformVisa && platformVisaRequestId ? (
          <form
            action={actions.upsertPlatformVisa}
            className="grid gap-3 sm:grid-cols-2"
            data-testid="platform-visa-form"
          >
            <input type="hidden" name="student_case_id" value={client.id} />
            <input type="hidden" name="visa_case_id" value={platformVisaMutationId ?? ""} />
            <input type="hidden" name="request_id" value={platformVisaRequestId} />
            <label className={labelCls}>
              {t("country")}
              <input
                value={visa?.country ?? client.target_country ?? ""}
                readOnly
                className={cn(inputCls, "mt-1")}
              />
            </label>
            <label className={labelCls}>
              {t("status")}
              <select name="status" defaultValue={visa?.status ?? "not_started"} className={cn(inputCls, "mt-1")}>
                {VISA_STATUSES.map((s) => <option key={s} value={s}>{t(`visa.${s}`)}</option>)}
              </select>
            </label>
            <label className={cn(labelCls, "sm:col-span-2")}>
              {t("platformDecisionEvidenceRef")}
              <input
                name="evidence_reference"
                required
                autoComplete="off"
                className={cn(inputCls, "mt-1")}
              />
            </label>
            <label className={cn(labelCls, "sm:col-span-2")}>
              {t("platformDecisionReason")}
              <input name="note" defaultValue="" className={cn(inputCls, "mt-1")} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={btnCls}>{visa ? t("save") : `+ ${t("addVisaCase")}`}</button>
            </div>
          </form>
          ) : actions.upsertVisa ? (
          <form action={actions.upsertVisa} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="client_id" value={client.id} />
            <label className={labelCls}>
              {t("country")}
              <input name="country" defaultValue={visa?.country ?? client.target_country ?? ""} className={cn(inputCls, "mt-1")} />
            </label>
            <label className={labelCls}>
              {t("status")}
              <select name="status" defaultValue={visa?.status ?? "not_started"} className={cn(inputCls, "mt-1")}>
                {VISA_STATUSES.map((s) => <option key={s} value={s}>{t(`visa.${s}`)}</option>)}
              </select>
            </label>
            <label className={labelCls}>
              {t("appointment")}
              <input name="appointment_at" type="date" defaultValue={visa?.appointment_at ?? ""} className={cn(inputCls, "mt-1 font-mono")} />
            </label>
            <label className={labelCls}>
              {t("notes")}
              <input name="notes" defaultValue={visa?.notes ?? ""} className={cn(inputCls, "mt-1")} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={btnCls}>{visa ? t("save") : `+ ${t("addVisaCase")}`}</button>
            </div>
          </form>
          ) : visa ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                [t("country"), visa.country],
                [t("status"), visa.status],
                [t("appointment"), visa.appointment_at ?? "—"],
                [t("notes"), visa.notes ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-nav bg-surface-2 p-3">
                  <dt className={labelCls}>{label}</dt>
                  <dd className="mt-1 text-[13px] text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <EmptyState text={t("noResults")} />
          )}
          </Card>
        </section>

        {/* Open work */}
        <section id="tasks" className="min-w-0 scroll-mt-24">
          <Card title={t("openWork")}>
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-fg">{task.title}</div>
                  <div className="text-[12px] text-fg-3">
                    {[task.assignee_name, task.due_date ? `${t("dueDate")}: ${task.due_date}` : null, t(`prio.${task.priority}`)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {actions.moveTask && (
                <form
                  action={actions.moveTask}
                  className="grid w-full gap-2 rounded-ctl border border-border bg-surface-2 p-2 sm:w-72"
                  data-testid={`platform-case-task-change-form-${task.id}`}
                >
                  {connected ? (
                    <>
                      <input type="hidden" name="student_case_id" value={client.id} />
                      <input type="hidden" name="case_task_id" value={task.id} />
                      <input type="hidden" name="request_id" value={task.request_id ?? randomUUID()} />
                      <input
                        type="hidden"
                        name="student_visible"
                        value={task.student_visible ? "true" : "false"}
                      />
                    </>
                  ) : (
                    <input type="hidden" name="id" value={task.id} />
                  )}
                  <label className={cn(labelCls, "mb-0 min-w-0 flex-1 sm:min-w-32")}>
                    {t("status")}
                    <select
                      name="status"
                      defaultValue={task.status}
                      className={cn(selectCls, "mt-1 w-full")}
                    >
                      {(connected
                        ? ["open", "in_progress", "blocked", "done", "cancelled"]
                        : TASK_COLUMNS).map((s) => (
                        <option key={s} value={s}>
                          {connected ? s : t(`col.${s}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {connected ? taskMutationScope === "full" ? (
                    <>
                      <label className={cn(labelCls, "mb-0")}>
                        {t("assignee")}
                        <select
                          name="assignee_membership_id"
                          defaultValue={task.assignee_membership_id ?? ""}
                          required
                          className={cn(selectCls, "mt-1 w-full")}
                        >
                          {taskAssignees.map((assignee) => (
                            <option key={assignee.id} value={assignee.id}>
                              {assignee.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={cn(labelCls, "mb-0")}>
                        {t("priority")}
                        <select
                          name="priority"
                          defaultValue={task.priority}
                          className={cn(selectCls, "mt-1 w-full")}
                        >
                          {TASK_PRIORITIES.map((priority) => (
                            <option key={priority} value={priority}>
                              {t(`prio.${priority}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={cn(labelCls, "mb-0")}>
                        {t("dueDate")}
                        <input
                          name="due_at"
                          type="date"
                          defaultValue={task.due_date ?? ""}
                          className={cn(inputCls, "mt-1 w-full font-mono")}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <input
                        type="hidden"
                        name="assignee_membership_id"
                        value={task.assignee_membership_id ?? ""}
                      />
                      <input type="hidden" name="priority" value={task.priority} />
                      <input type="hidden" name="due_at" value={task.due_date ?? ""} />
                    </>
                  ) : null}
                  <button type="submit" className={btnGhostCls}>{t("save")}</button>
                </form>
                )}
              </li>
            ))}
          </ul>
          {tasks.length === 0 && <EmptyState text={t("noStudentTasks")} />}
          {actions.addTask && (
          <details className="mt-3 border-t border-border pt-3">
            <summary className={cn(btnGhostCls, "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
              + {t("addTask")}
            </summary>
            <form
              action={actions.addTask}
              className="mt-3 grid gap-2 sm:grid-cols-2"
              data-testid="platform-case-task-create-form"
            >
              {connected ? (
                <>
                  <input type="hidden" name="student_case_id" value={client.id} />
                  <input type="hidden" name="request_id" value={randomUUID()} />
                  <input type="hidden" name="task_type" value="admissions_case_task" />
                  <input type="hidden" name="status" value="open" />
                  <input type="hidden" name="student_visible" value="false" />
                </>
              ) : (
                <input type="hidden" name="client_id" value={client.id} />
              )}
              <label className={cn(labelCls, "mb-0 sm:col-span-2")}>
                {t("title")}
                <input name="title" required placeholder={t("title")} className={cn(inputCls, "mt-1")} />
              </label>
              <label className={cn(labelCls, "mb-0")}>
                {t("priority")}
                <select name="priority" defaultValue="normal" className={cn(inputCls, "mt-1")}>
                  {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{t(`prio.${p}`)}</option>)}
                </select>
              </label>
              <label className={cn(labelCls, "mb-0")}>
                {t("assignee")}
                <select
                  name={connected ? "assignee_membership_id" : "assignee_id"}
                  required={connected}
                  className={cn(inputCls, "mt-1")}
                >
                  {connected ? null : <option value="">{t("notAssigned")}</option>}
                  {taskAssignees.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className={cn(labelCls, "mb-0")}>
                {t("dueDate")}
                <input
                  name={connected ? "due_at" : "due_date"}
                  type="date"
                  className={cn(inputCls, "mt-1 font-mono")}
                />
              </label>
              <button type="submit" className={btnCls}>+ {t("addTask")}</button>
            </form>
          </details>
          )}
          </Card>
        </section>

        {/* Payments */}
        <section id="payments" className="min-w-0 scroll-mt-24 lg:col-span-2">
          <Card title={t("payments")}>
          <ul className="divide-y divide-border">
            {payments.map((p) => (
              <li
                key={p.id}
                className="grid gap-3 py-4 first:pt-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]"
                data-testid={p.settlement_request_id ? `platform-payment-${p.id}` : undefined}
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-fg">{p.title}</div>
                  <div className="font-mono text-[12px] text-fg-3">
                    {financeLabels.expected}: {num(p.amount)} {p.currency}
                    {p.due_date ? ` · ${t("dueDate")}: ${p.due_date}` : ""}
                  </div>
                  {typeof p.total_paid_minor === "number"
                    && typeof p.outstanding_minor === "number" ? (
                    <div className="mt-1 font-mono text-[12px] text-fg-3">
                      {financeLabels.received}: {num(p.total_paid_minor / 100)} {p.currency}
                      {p.total_refunded_minor
                        ? ` · Refund: ${num(p.total_refunded_minor / 100)} ${p.currency}`
                        : ""}
                      {` · ${financeLabels.remaining}: ${num(p.outstanding_minor / 100)} ${p.currency}`}
                    </div>
                  ) : null}
                  {typeof p.payment_confirmation_count === "number" ? (
                    <div className="mt-1 text-[12px] text-fg-3">
                      {financeLabels.confirmations}: {p.payment_confirmation_count}
                      {p.last_payment_at
                        ? ` · ${financeLabels.lastConfirmation}: ${p.last_payment_at}`
                        : ""}
                    </div>
                  ) : null}
                  {p.next_action ? (
                    <div className="mt-1 text-[12px] text-fg-3">
                      {t("nextAction")}: {p.next_action}
                    </div>
                  ) : null}
                  {(p.active_stop_factors ?? []).map((stop) => (
                    <div
                      key={stop.id}
                      className="mt-3 rounded-ctl border border-danger/30 bg-danger-weak p-3 text-[12px]"
                      data-testid={`platform-finance-stop-${stop.id}`}
                    >
                      <div className="font-bold text-danger">{financeLabels.stopped}</div>
                      <dl className="mt-2 grid gap-1 text-fg-2">
                        <div><dt className="inline font-semibold">{financeLabels.blockedWork}: </dt><dd className="inline">{financeBlockedActionLabel(stop.blocked_action)}</dd></div>
                        <div><dt className="inline font-semibold">{financeLabels.stopReason}: </dt><dd className="inline">{stop.reason}</dd></div>
                        <div><dt className="inline font-semibold">{financeLabels.stopNextAction}: </dt><dd className="inline">{stop.next_action}</dd></div>
                        <div><dt className="inline font-semibold">{financeLabels.stopOwner}: </dt><dd className="inline">{stop.owner_name}</dd></div>
                        <div><dt className="inline font-semibold">{financeLabels.stopCreatedAt}: </dt><dd className="inline font-mono">{stop.created_at}</dd></div>
                      </dl>
                      {canMutateFinanceStops
                        && actions.resolvePlatformFinanceStop
                        && stop.resolution_request_id ? (
                        <details className="mt-3 border-t border-danger/20 pt-2">
                          <summary className={cn(btnGhostCls, "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>{financeLabels.clearStop}</summary>
                          <form
                            action={actions.resolvePlatformFinanceStop}
                            className="mt-2 grid gap-2"
                            data-testid={`platform-finance-stop-resolve-form-${stop.id}`}
                          >
                            <input type="hidden" name="student_case_id" value={client.id} />
                            <input type="hidden" name="stop_factor_id" value={stop.id} />
                            <input type="hidden" name="request_id" value={stop.resolution_request_id} />
                            <label className={cn(labelCls, "mb-0")}>
                              {financeLabels.evidence}
                              <input name="evidence_ref" required autoComplete="off" className={cn(inputCls, "mt-1")} />
                            </label>
                            <label className={cn(labelCls, "mb-0")}>
                              {financeLabels.reason}
                              <input name="reason" required minLength={3} className={cn(inputCls, "mt-1")} />
                            </label>
                            <button type="submit" className={btnGhostCls}>{financeLabels.clearStop}</button>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="flex flex-col items-stretch gap-2">
                  <Badge value={p.status} label={t(`pay.${p.status}`)} />
                  {canMutatePayments
                    && actions.markPlatformPaymentPaid
                    && (p.status !== "paid" || p.settlement_retry)
                    && p.settlement_request_id && (
                    <form
                      action={actions.markPlatformPaymentPaid}
                      className="grid w-full gap-2 rounded-ctl border border-border bg-surface-2 p-2 sm:w-72"
                      data-testid={`platform-payment-settle-form-${p.id}`}
                    >
                      <input type="hidden" name="student_case_id" value={client.id} />
                      <input type="hidden" name="payment_obligation_id" value={p.id} />
                      <input type="hidden" name="request_id" value={p.settlement_request_id} />
                      <label className={cn(labelCls, "mb-0")}>
                        {t("platformDecisionEvidenceRef")}
                        <input name="evidence_ref" required autoComplete="off" className={cn(inputCls, "mt-1")} />
                      </label>
                      <label className={cn(labelCls, "mb-0")}>
                        {t("platformDecisionReason")}
                        <input name="reason" required minLength={3} className={cn(inputCls, "mt-1")} />
                      </label>
                      <button type="submit" className={btnGhostCls}>{t("markPaid")}</button>
                    </form>
                  )}
                  {canMutatePayments
                    && !actions.markPlatformPaymentPaid
                    && actions.markPaymentPaid
                    && p.status !== "paid" && (
                    <form action={actions.markPaymentPaid}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="client_id" value={client.id} />
                      <button type="submit" className={btnGhostCls}>{t("markPaid")}</button>
                    </form>
                  )}
                  {canMutateFinanceStops
                    && actions.createPlatformFinanceStop
                    && p.status !== "paid"
                    && p.stop_create_request_id ? (
                    <details className="rounded-ctl border border-border bg-surface-2 p-2">
                      <summary className={cn(btnGhostCls, "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>{financeLabels.createStop}</summary>
                      <form
                        action={actions.createPlatformFinanceStop}
                        className="mt-2 grid gap-2"
                        data-testid={`platform-finance-stop-create-form-${p.id}`}
                      >
                        <input type="hidden" name="student_case_id" value={client.id} />
                        <input type="hidden" name="payment_obligation_id" value={p.id} />
                        <input type="hidden" name="request_id" value={p.stop_create_request_id} />
                        <label className={cn(labelCls, "mb-0")}>
                          {financeLabels.blockedWork}
                          <select name="blocked_action" defaultValue="application_submission" className={cn(inputCls, "mt-1")}>
                            {Object.entries(financeLabels.actions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </label>
                        <label className={cn(labelCls, "mb-0")}>
                          {financeLabels.stopReason}
                          <input name="reason" required minLength={3} className={cn(inputCls, "mt-1")} />
                        </label>
                        <label className={cn(labelCls, "mb-0")}>
                          {financeLabels.nextAction}
                          <input name="next_action" required minLength={3} className={cn(inputCls, "mt-1")} />
                        </label>
                        <label className={cn(labelCls, "mb-0")}>
                          {financeLabels.evidence}
                          <input name="evidence_ref" required autoComplete="off" className={cn(inputCls, "mt-1")} />
                        </label>
                        <button type="submit" className={btnGhostCls}>{financeLabels.createStop}</button>
                      </form>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {payments.length === 0 && <EmptyState text={t("noResults")} />}
          {canMutatePayments && actions.addPlatformPayment && platformPaymentCreateRequestId ? (
            <details className="mt-3 border-t border-border pt-3">
              <summary className={cn(btnGhostCls, "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                + {t("addPayment")}
              </summary>
              <form
                action={actions.addPlatformPayment}
                className="mt-3 grid gap-2 sm:grid-cols-2"
                data-testid="platform-payment-create-form"
              >
                <input type="hidden" name="student_case_id" value={client.id} />
                <input type="hidden" name="request_id" value={platformPaymentCreateRequestId} />
                <label className={cn(labelCls, "mb-0 sm:col-span-2")}>
                  {t("payment")}
                  <input name="label" required placeholder={t("payment")} className={cn(inputCls, "mt-1")} />
                </label>
                <label className={cn(labelCls, "mb-0")}>
                  {t("paymentCategory")}
                  <select name="category" defaultValue="evo_service_fee" className={cn(inputCls, "mt-1")}>
                    <option value="evo_service_fee">{t("paymentCategory.evo_service_fee")}</option>
                    <option value="third_party_cost">{t("paymentCategory.third_party_cost")}</option>
                  </select>
                </label>
                <label className={cn(labelCls, "mb-0")}>
                  {t("amount")}
                  <input name="amount" type="number" min="0.01" step="0.01" required className={cn(inputCls, "mt-1")} />
                </label>
                <label className={cn(labelCls, "mb-0")}>
                  KGS / USD / EUR
                  <select name="currency" defaultValue="KGS" className={cn(inputCls, "mt-1")}>
                    <option value="KGS">KGS</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </label>
                <label className={cn(labelCls, "mb-0")}>
                  {t("dueDate")}
                  <input name="due_date" type="date" required className={cn(inputCls, "mt-1 font-mono")} />
                </label>
                <label className={cn(labelCls, "mb-0 sm:col-span-2")}>
                  {t("nextAction")}
                  <input name="next_action" required className={cn(inputCls, "mt-1")} />
                </label>
                <label className={cn(labelCls, "mb-0 sm:col-span-2")}>
                  {t("platformDecisionReason")}
                  <input name="reason" required minLength={3} className={cn(inputCls, "mt-1")} />
                </label>
                <button type="submit" className={btnCls}>+ {t("addPayment")}</button>
              </form>
            </details>
          ) : canMutatePayments && actions.addPayment && (
            <details className="mt-3 border-t border-border pt-3">
              <summary className={cn(btnGhostCls, "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                + {t("addPayment")}
              </summary>
              <form action={actions.addPayment} className="mt-3 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="client_id" value={client.id} />
                <label className={cn(labelCls, "mb-0 sm:col-span-2")}>
                  {t("payment")}
                  <input name="title" required placeholder={t("payment")} className={cn(inputCls, "mt-1")} />
                </label>
                <label className={cn(labelCls, "mb-0")}>
                  {t("amount")}
                  <input name="amount" type="number" step="0.01" required placeholder={t("amount")} className={cn(inputCls, "mt-1")} />
                </label>
                <label className={cn(labelCls, "mb-0")}>
                  KGS / USD / EUR
                  <select name="currency" className={cn(inputCls, "mt-1")}>
                    <option value="KGS">KGS</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </label>
                <label className={cn(labelCls, "mb-0")}>
                  {t("dueDate")}
                  <input name="due_date" type="date" className={cn(inputCls, "mt-1 font-mono")} />
                </label>
                <button type="submit" className={btnCls}>+ {t("addPayment")}</button>
              </form>
            </details>
          )}
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-[12px] font-bold uppercase tracking-[0.06em] text-fg-3">{financeLabels.history}</h3>
            {financeHistory.length > 0 ? (
              <ol className="mt-2 divide-y divide-border" data-testid="platform-finance-history">
                {financeHistory.map((event) => (
                  <li key={event.id} className="py-2 text-[12px]" data-testid="platform-finance-history-row">
                    <div className="font-semibold text-fg">{financeHistoryActionLabel(event.action)}</div>
                    <div className="mt-0.5 text-fg-2">{event.reason}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-fg-3">{event.actor_name} · {event.occurred_at}</div>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-[12px] text-fg-3">{financeLabels.historyEmpty}</p>}
          </div>
          </Card>
        </section>
      </div>

      {/* Updates */}
      <section id="updates" className="scroll-mt-24">
        <Card title={t("updates")}>
        {actions.postUpdate && (
        <form
          action={actions.postUpdate}
          className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end"
          data-testid="platform-case-update-form"
        >
          {connected ? (
            <>
              <input type="hidden" name="student_case_id" value={client.id} />
              <input type="hidden" name="request_id" value={randomUUID()} />
              <input type="hidden" name="source" value="staff_manual_note" />
              <input type="hidden" name="student_visible" value="false" />
              <input
                type="hidden"
                name="occurred_at"
                value={new Date().toISOString()}
              />
            </>
          ) : (
            <input type="hidden" name="client_id" value={client.id} />
          )}
          <label className={cn(labelCls, "mb-0 min-w-0 flex-1")}>
            {t("updates")}
            <input
              name={connected ? "body" : "message"}
              required
              placeholder={t("updatePlaceholder")}
              className={cn(inputCls, "mt-1")}
            />
          </label>
          <button type="submit" className={btnCls}>{t("send")}</button>
        </form>
        )}
        {updates.length === 0 ? (
          <EmptyState text={t("noUpdates")} />
        ) : (
          <ul className="space-y-2.5">
            {updates.map((u) => (
              <li key={u.id} className="rounded-ctl bg-surface-2 px-4 py-3">
                <p className="text-[13.5px] text-fg">{u.message}</p>
                <p className="mt-1 font-mono text-[11px] text-fg-3">
                  {u.author_name ?? "—"} · {u.created_at}
                </p>
              </li>
            ))}
          </ul>
        )}
        </Card>
      </section>
    </div>
  );
}
