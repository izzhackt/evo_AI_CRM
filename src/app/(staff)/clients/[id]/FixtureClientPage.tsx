import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, type Locale } from "@/lib/i18n";
import { Badge, Card, EmptyState, StatCard, inputCls, btnCls, btnGhostCls, labelCls, cn } from "@/components/ui";
import { AiSummary } from "@/components/AiSummary";
import { StudentProgress } from "@/components/platform/core/StudentProgress";
import {
  ContractDraftReportWorkspace,
  type ContractDraftReportActions,
  type ContractDraftReportRequestIdFor,
  type ContractDraftReportResult,
} from "./ContractDraftReportWorkspace";
import type { PlatformCaseContractWorkspace } from "@/lib/platform-contract-workflow";
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
type PresentationPayment = Readonly<{
  id: EntityId;
  title: string;
  amount: number;
  currency: string;
  due_date: string | null;
  status: string;
  category?: "evo_service_fee" | "third_party_cost";
  next_action?: string;
  outstanding_minor?: number;
  settlement_request_id?: string;
  settlement_retry?: boolean;
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
type PresentationAdmissionsHandoffContext = Readonly<{
  mode: string;
  reason: string;
  handedOffAt: string;
  actorName: string;
  ownerName: string;
  clientName: string;
  salesStage: string;
  nextAction: string | null;
  nextActionDueDate: string | null;
  conversations: readonly Readonly<{
    id: string;
    subject: string;
    queue: string;
    status: string;
    updatedAt: string;
  }>[];
  provenance: readonly Readonly<{
    id: string;
    sourceSystem: string;
    evidenceType: string;
    sourceReference: string | null;
    observedAt: string;
  }>[];
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
  addTask?: ServerFormAction;
  moveTask?: ServerFormAction;
  postUpdate?: ServerFormAction;
  assignCurator?: ServerFormAction;
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
      tasks: readonly PresentationTask[];
      handoffContext?: PresentationAdmissionsHandoffContext | null;
      updates: readonly PresentationUpdate[];
      taskAssignees: readonly Readonly<{ id: EntityId; name: string }>[];
      curators: readonly Readonly<{ id: EntityId; name: string }>[];
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

async function loadFixtureClientPageData(id: string): Promise<ClientPagePresentationData | null> {
  const [{ requireStaffRoute }, queries, dbValues, actions, access] = await Promise.all([
    import("@/lib/guards"),
    import("@/lib/queries"),
    import("@/lib/db"),
    import("@/lib/actions"),
    import("@/lib/access"),
  ]);
  const user = await requireStaffRoute("/clients");
  const clientId = parseInt(id, 10);
  const sourceClient = queries.getClientForActor(user, clientId);
  if (!sourceClient) return null;

  if (sourceClient.access_mode === "sales_post_handoff_summary") {
    return {
      access: "summary",
      client: {
        access_mode: sourceClient.access_mode,
        id: sourceClient.id,
        name: sourceClient.name,
        stage: sourceClient.stage,
        target_country: sourceClient.target_country,
        target_degree: sourceClient.target_degree,
        case_state: sourceClient.case_state,
        curator_name: sourceClient.curator_name,
        handoff_at: sourceClient.handoff_at,
      },
      testId: "sales-handoff-summary",
    };
  }

  const snapshot = queries.studentCaseSnapshotForUser(sourceClient.user_id);
  if (!snapshot) return null;
  const applications = queries.clientApplicationsForActor(user, clientId);
  const documents = queries.clientDocumentsForActor(user, clientId);
  const visa = queries.clientVisaCaseForActor(user, clientId) ?? null;
  const payments = queries.clientPaymentsForActor(user, clientId);
  const tasks = queries.clientTasksForActor(user, clientId);
  const updates = queries.clientUpdatesForActor(user, clientId);
  const canManageLifecycle =
    user.role === "admin" || (user.role === "curator" && sourceClient.curator_id === user.id);

  return {
    access: "full",
    actor: { id: user.id, role: user.role },
    client: {
      access_mode: "full",
      id: sourceClient.id,
      name: sourceClient.name,
      email: sourceClient.email,
      phone: sourceClient.phone,
      stage: sourceClient.stage,
      target_country: sourceClient.target_country,
      target_degree: sourceClient.target_degree,
      case_state: sourceClient.case_state,
      contract_confirmed_at: sourceClient.contract_confirmed_at,
      contract_confirmation_ref: sourceClient.contract_confirmation_ref,
      portal_activated_at: sourceClient.portal_activated_at,
      handoff_at: sourceClient.handoff_at,
      curator_id: sourceClient.curator_id,
      curator_name: sourceClient.curator_name,
      manager_name: sourceClient.manager_name,
      notes: sourceClient.notes,
    },
    applications,
    documents,
    visa,
    payments,
    tasks,
    updates,
    taskAssignees: queries.listStaff().filter((person) =>
      access.canReceiveClientTask(person, sourceClient),
    ),
    curators: user.role === "admin" ? queries.listCurators() : [],
    audit: canManageLifecycle
      ? queries.studentCaseAuditForActor(user, clientId)
      : [],
    snapshot: {
      stageTimeline: snapshot.stageTimeline,
      nextAction: snapshot.nextAction,
      manager: snapshot.manager,
      curator: snapshot.curator,
      documents: snapshot.documents,
      payments: snapshot.payments,
      visa: snapshot.visa,
    },
    stageItems: dbValues.STAGES.map((stage) => ({ key: stage, label: "" })),
    applicationStatuses: dbValues.APP_STATUSES,
    taskColumns: dbValues.TASK_COLUMNS,
    taskPriorities: dbValues.TASK_PRIORITIES,
    visaStatuses: dbValues.VISA_STATUSES,
    actions: {
      updateClient: actions.updateClientAction,
      addApplication: actions.addApplicationAction,
      setApplicationStatus: actions.setApplicationStatusAction,
      addDocument: actions.addDocumentAction,
      upsertVisa: actions.upsertVisaCaseAction,
      addPayment: actions.addPaymentAction,
      markPaymentPaid: actions.markPaymentPaidAction,
      addTask: actions.addTaskAction,
      moveTask: actions.moveTaskAction,
      postUpdate: actions.postUpdateAction,
      assignCurator: actions.assignCuratorAction,
      closeCase: actions.closeStudentCaseAction,
      reopenCase: actions.reopenStudentCaseAction,
    },
    canManageLifecycle,
    canViewCaseAudit: canManageLifecycle,
    canMutatePayments: user.role === "admin" || user.role === "finance",
    canUseAiSummary: true,
    sourceHint: "",
    connected: false,
    testId: "client-full-detail",
  };
}

type FixtureClientPageProps = Readonly<{
  params?: Promise<{ id: string }>;
  data?: ClientPagePresentationData;
  locale?: Locale;
  t?: (key: string) => string;
}>;

export default async function FixtureClientPage({
  params,
  data: providedData,
  locale: providedLocale,
  t: providedT,
}: FixtureClientPageProps) {
  const data = providedData ?? (
    params
      ? await loadFixtureClientPageData((await params).id)
      : null
  );
  if (!data) notFound();

  const { t, locale } = providedLocale && providedT
    ? { t: providedT, locale: providedLocale }
    : await getT();
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
              [t("curator"), client.curator_name ?? t("notAssigned")],
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
    actor: user,
    applications: apps,
    documents: docs,
    visa,
    payments,
    tasks,
    handoffContext = null,
    updates,
    taskAssignees,
    curators,
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
      routeMissing: "Укажите направление программы — без него нельзя безопасно выбрать страновой чек-лист.",
      routeReady: "Проверьте направление программы перед назначением неизменяемой версии чек-листа.",
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
      routeMissing: "Программанын багытын көрсөтүңүз — ансыз өлкө чек-листин коопсуз тандоо мүмкүн эмес.",
      routeReady: "Өзгөрбөс чек-лист версиясын дайындоодон мурда программанын багытын текшериңиз.",
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
      routeMissing: "Enter the program direction before a country checklist can be selected safely.",
      routeReady: "Confirm the program direction before assigning an immutable checklist version.",
      programDirection: "Program direction",
      saveRoute: "Save route",
    },
  }[locale];
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
  const handoffLabels = {
    ru: {
      title: "Контекст передачи из Sales",
      mode: "Режим",
      reason: "Причина",
      actor: "Передал",
      owner: "Admissions owner",
      client: "Клиент",
      stage: "Sales-этап",
      nextAction: "Следующее действие Sales",
      conversations: "Связанные разговоры",
      provenance: "Источники происхождения",
      none: "Нет",
    },
    ky: {
      title: "Sales бөлүмүнөн өткөрүлгөн контекст",
      mode: "Режим",
      reason: "Себеп",
      actor: "Өткөргөн",
      owner: "Admissions owner",
      client: "Кардар",
      stage: "Sales этабы",
      nextAction: "Sales кийинки аракети",
      conversations: "Байланышкан сүйлөшүүлөр",
      provenance: "Булак далилдери",
      none: "Жок",
    },
    en: {
      title: "Inherited Sales handoff context",
      mode: "Mode",
      reason: "Reason",
      actor: "Handed off by",
      owner: "Admissions owner",
      client: "Client",
      stage: "Sales stage",
      nextAction: "Sales next action",
      conversations: "Linked conversations",
      provenance: "Provenance sources",
      none: "None",
    },
  }[locale];
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
                [t("curator"), snapshot.curator],
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
          {handoffContext ? (
            <div
              className="mb-4 rounded-nav border border-border bg-surface-2 p-3"
              data-testid="platform-admissions-handoff-context"
            >
              <p className="text-[13px] font-semibold text-fg">{handoffLabels.title}</p>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  [handoffLabels.mode, handoffContext.mode],
                  [handoffLabels.actor, handoffContext.actorName],
                  [handoffLabels.owner, handoffContext.ownerName],
                  [handoffLabels.client, handoffContext.clientName],
                  [handoffLabels.stage, handoffContext.salesStage],
                  [
                    handoffLabels.nextAction,
                    handoffContext.nextAction
                      ? `${handoffContext.nextAction}${
                        handoffContext.nextActionDueDate
                          ? ` · ${handoffContext.nextActionDueDate}`
                          : ""
                      }`
                      : handoffLabels.none,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words text-[12.5px] text-fg-2">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                  {handoffLabels.reason}
                </p>
                <p className="mt-1 break-words text-[12.5px] text-fg-2">
                  {handoffContext.reason}
                </p>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                    {handoffLabels.conversations}
                  </p>
                  {handoffContext.conversations.length > 0 ? (
                    <ul className="mt-1 space-y-2">
                      {handoffContext.conversations.map((conversation) => (
                        <li key={conversation.id} className="text-[12.5px] text-fg-2">
                          <p>{conversation.subject}</p>
                          <p className="text-[11px] text-fg-3">
                            {conversation.queue} · {conversation.status} · {conversation.updatedAt}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12.5px] text-fg-3">{handoffLabels.none}</p>
                  )}
                </div>
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                    {handoffLabels.provenance}
                  </p>
                  {handoffContext.provenance.length > 0 ? (
                    <ul className="mt-1 space-y-2">
                      {handoffContext.provenance.map((source) => (
                        <li key={source.id} className="text-[12.5px] text-fg-2">
                          <p>{source.sourceSystem} · {source.evidenceType}</p>
                          <p className="break-all text-[11px] text-fg-3">
                            {source.sourceReference ?? handoffLabels.none} · {source.observedAt}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12.5px] text-fg-3">{handoffLabels.none}</p>
                  )}
                </div>
              </div>
              <p className="mt-3 font-mono text-[10.5px] text-fg-3">
                {handoffContext.handedOffAt}
              </p>
            </div>
          ) : null}
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

          {user.role === "admin" && actions.assignCurator ? (
            <form
              action={actions.assignCurator}
              data-testid="curator-assignment-form"
              className="mt-4 grid gap-3 rounded-nav border border-border bg-surface-2 p-3 sm:grid-cols-2"
            >
              <input type="hidden" name="client_id" value={client.id} />
              {actions.changePlatformState && data.lifecycleRequestId ? (
                <input
                  type="hidden"
                  name="request_id"
                  value={data.lifecycleRequestId}
                />
              ) : null}
              <div className="sm:col-span-2">
                <p className="text-[13px] font-semibold text-fg">{t("curatorAssignment")}</p>
                <p className="mt-1 text-[11px] leading-4 text-fg-3">{t("curatorAssignmentHint")}</p>
              </div>
              <label className={labelCls}>
                {t("curator")}
                <select
                  name="curator_id"
                  required
                  defaultValue={client.curator_id ?? ""}
                  className={cn(inputCls, "mt-1")}
                >
                  <option value="">{t("notAssigned")}</option>
                  {curators.map((curator) => (
                    <option key={curator.id} value={curator.id}>{curator.name}</option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                {t("assignmentReason")}
                <textarea
                  name="reason"
                  required
                  maxLength={1000}
                  rows={2}
                  className={cn(inputCls, "mt-1 resize-y py-2")}
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={!contractConfirmed}
                  className={cn(btnCls, !contractConfirmed && "cursor-not-allowed opacity-55")}
                >
                  {client.curator_id ? t("reassignCurator") : t("assignCurator")}
                </button>
              </div>
            </form>
          ) : null}

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
                  <input type="hidden" name="target_country" value={studentRoute.targetCountry} />
                  <input type="hidden" name="target_degree" value={studentRoute.targetDegree} />
                  <input type="hidden" name="intake" value={studentRoute.intake ?? ""} />
                  <input type="hidden" name="language_assumption" value={studentRoute.languageAssumption ?? ""} />
                  <input type="hidden" name="funding_assumption" value={studentRoute.fundingAssumption ?? ""} />
                  <input type="hidden" name="operational_stage" value={studentRoute.operationalStage} />
                  <input type="hidden" name="next_action" value={studentRoute.nextAction ?? ""} />
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
            <p className={labelCls}>{t("curator")}</p>
            <p className="mt-1 text-[13px] font-medium text-fg">{client.curator_name ?? t("notAssigned")}</p>
            <p className="mt-1 text-[10.5px] leading-4 text-fg-3">{t("curatorReadOnlyHint")}</p>
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
              [t("curator"), client.curator_name ?? t("notAssigned")],
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
                  {connected ? (
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
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0"
                data-testid={p.settlement_request_id ? `platform-payment-${p.id}` : undefined}
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-fg">{p.title}</div>
                  <div className="font-mono text-[12px] text-fg-3">
                    {num(p.amount)} {p.currency}
                    {p.due_date ? ` · ${t("dueDate")}: ${p.due_date}` : ""}
                  </div>
                  {p.next_action ? (
                    <div className="mt-1 text-[12px] text-fg-3">
                      {t("nextAction")}: {p.next_action}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
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
