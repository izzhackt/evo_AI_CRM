import { randomUUID } from "node:crypto";

import Link from "next/link";

import {
  PlatformAdmissionsOperationsPanel,
  type PlatformAdmissionsOperationsFeedback,
  type PlatformAdmissionsOperationsRequestIds,
} from "@/components/platform/admissions/PlatformAdmissionsOperationsPanel";
import {
  PlatformAdmissionsTaskPanel,
  type PlatformAdmissionsTaskFeedback,
  type PlatformAdmissionsTaskRequestIds,
} from "@/components/platform/admissions/PlatformAdmissionsTaskPanel";
import {
  PlatformPrivateDocumentsPanel,
  type PlatformDocumentReviewFeedback,
  type PlatformDocumentRequestIds,
} from "@/components/platform/documents/PlatformPrivateDocumentsPanel";
import { Card, btnGhostCls, cn } from "@/components/ui";
import { getT, type Locale } from "@/lib/i18n";
import { listPlatformApplicationsForStudentCase } from "@/lib/platform-admissions";
import { getPlatformAdmissionsTaskWorkspace } from "@/lib/platform-admissions-workspace";
import { getPlatformCaseVisa } from "@/lib/platform-case-operations";
import {
  approvePlatformContractTemplateVersionAction,
  createPlatformContractTemplateVersionAction,
  generatePlatformPostContractReportAction,
  generatePlatformStudentCaseContractDraftAction,
  retirePlatformContractTemplateVersionAction,
  reviewPlatformPostContractReportAction,
  reviewPlatformStudentCaseContractDraftAction,
  seedPlatformPostContractItemsAction,
  updatePlatformPostContractItemAction,
} from "@/lib/platform-contract-actions";
import {
  getPlatformCaseContractWorkspace,
  type PlatformContractMutationOutcome,
  type PlatformContractRetryOperation,
} from "@/lib/platform-contract-workflow";
import { getPlatformCaseFinanceControl } from "@/lib/platform-finance-control";
import { requirePlatformAdmissionsActor } from "@/lib/platform-guards";
import { getPlatformCaseDocumentWorkspace } from "@/lib/platform-private-documents";
import { getPlatformStudentCaseHandoffContext } from "@/lib/platform-student-handoff";
import { getPlatformStudentProfile } from "@/lib/platform-student-profile";
import { CanonicalAmoCrmCommandSection } from "./CanonicalAmoCrmCommandSection";
import {
  ContractDraftReportWorkspace,
  type ContractDraftReportActions,
  type ContractDraftReportRequestIdFor,
} from "./ContractDraftReportWorkspace";

const COPY = {
  ru: {
    description:
      "Единый контекст студента, передачи Sales и договора из защищённого Supabase PostgreSQL.",
    sectionNavigation: "Разделы Student 360",
    summary: "Обзор",
    profile: "Профиль",
    handoff: "Передача",
    contract: "Договор",
    tasks: "Задачи",
    documents: "Документы",
    applications: "Заявки",
    visa: "Виза",
    finance: "Финансы",
    operations: "Заявки, виза и финансы",
    amocrm: "amoCRM",
    state: "Состояние кейса",
    caseId: "ID кейса",
    leadId: "ID лида",
    clientId: "ID клиента",
    handedOffAt: "Передан в Admissions",
    handoffMode: "Режим передачи",
    handoffState: "Статус передачи",
    handoffReason: "Причина",
    handoffSource: "Источник",
    gateState: "Коммерческий gate",
    gateVersion: "Версия gate",
    owner: "Владелец Admissions",
    executedBy: "Передала",
    inheritedSales: "Контекст Sales",
    starterTasks: "Стартовые задачи",
    noStarterTasks: "Стартовые задачи отсутствуют.",
    citizenship: "Гражданство",
    residency: "Проживание",
    communicationLanguage: "Язык общения",
    education: "Текущее образование",
    academic: "Академический контекст",
    language: "Языковой контекст",
    budget: "Бюджет",
    decisionParticipants: "Участники решения",
    consent: "Согласие",
    profileNextStep: "Следующий шаг профиля",
    profileNotCreated:
      "Профиль ещё не заполнен. Кейс и передача уже сохранены в Supabase; Admissions должен внести реальные данные студента.",
    absent: "Не указано",
  },
  ky: {
    description:
      "Студенттин, Sales өткөрүүсүнүн жана келишимдин бирдиктүү контексти корголгон Supabase PostgreSQL базасынан алынат.",
    sectionNavigation: "Student 360 бөлүмдөрү",
    summary: "Обзор",
    profile: "Профиль",
    handoff: "Өткөрүү",
    contract: "Келишим",
    tasks: "Тапшырмалар",
    documents: "Документтер",
    applications: "Арыздар",
    visa: "Виза",
    finance: "Каржы",
    operations: "Арыздар, виза жана каржы",
    amocrm: "amoCRM",
    state: "Кейстин абалы",
    caseId: "Кейс ID",
    leadId: "Лид ID",
    clientId: "Кардар ID",
    handedOffAt: "Admissions бөлүмүнө өткөрүлдү",
    handoffMode: "Өткөрүү режими",
    handoffState: "Өткөрүү статусу",
    handoffReason: "Себеби",
    handoffSource: "Булак",
    gateState: "Коммерциялык gate",
    gateVersion: "Gate версиясы",
    owner: "Admissions жооптуусу",
    executedBy: "Өткөргөн",
    inheritedSales: "Sales контексти",
    starterTasks: "Баштапкы тапшырмалар",
    noStarterTasks: "Баштапкы тапшырмалар жок.",
    citizenship: "Жарандык",
    residency: "Жашаган жери",
    communicationLanguage: "Байланыш тили",
    education: "Учурдагы билим",
    academic: "Академиялык контекст",
    language: "Тил контексти",
    budget: "Бюджет",
    decisionParticipants: "Чечим катышуучулары",
    consent: "Макулдук",
    profileNextStep: "Профилдин кийинки кадамы",
    profileNotCreated:
      "Профиль азырынча толтурула элек. Кейс жана өткөрүү Supabase'те сакталды; Admissions студенттин чыныгы маалыматтарын киргизиши керек.",
    absent: "Көрсөтүлгөн эмес",
  },
  en: {
    description:
      "One student, Sales handoff and contract context from protected Supabase PostgreSQL.",
    sectionNavigation: "Student 360 sections",
    summary: "Overview",
    profile: "Profile",
    handoff: "Handoff",
    contract: "Contract",
    tasks: "Tasks",
    documents: "Documents",
    applications: "Applications",
    visa: "Visa",
    finance: "Finance",
    operations: "Applications, visa and finance",
    amocrm: "amoCRM",
    state: "Case state",
    caseId: "Case ID",
    leadId: "Lead ID",
    clientId: "Client ID",
    handedOffAt: "Handed off to Admissions",
    handoffMode: "Handoff mode",
    handoffState: "Handoff status",
    handoffReason: "Reason",
    handoffSource: "Source",
    gateState: "Commercial gate",
    gateVersion: "Gate version",
    owner: "Admissions owner",
    executedBy: "Executed by",
    inheritedSales: "Sales context",
    starterTasks: "Starter tasks",
    noStarterTasks: "No starter tasks are present.",
    citizenship: "Citizenship",
    residency: "Residence",
    communicationLanguage: "Communication language",
    education: "Current education",
    academic: "Academic context",
    language: "Language context",
    budget: "Budget",
    decisionParticipants: "Decision participants",
    consent: "Consent",
    profileNextStep: "Profile next step",
    profileNotCreated:
      "The profile has not been completed yet. The case and handoff are saved in Supabase; Admissions must enter the student's real details.",
    absent: "Not provided",
  },
} as const;

const CONTRACT_ACTIONS: ContractDraftReportActions = {
  createTemplate: createPlatformContractTemplateVersionAction,
  approveTemplate: approvePlatformContractTemplateVersionAction,
  retireTemplate: retirePlatformContractTemplateVersionAction,
  generateDraft: generatePlatformStudentCaseContractDraftAction,
  reviewDraft: reviewPlatformStudentCaseContractDraftAction,
  seedItems: seedPlatformPostContractItemsAction,
  updateItem: updatePlatformPostContractItemAction,
  generateReport: generatePlatformPostContractReportAction,
  reviewReport: reviewPlatformPostContractReportAction,
};

export type StudentCaseContractRetry = Readonly<{
  requestId: string;
  operation: PlatformContractRetryOperation;
  subjectId?: string;
}>;

export type StudentCaseTaskRetry = Readonly<{
  requestId: string;
  operation: "create" | "change";
  subjectId?: string;
}>;

export type StudentCaseApplicationRetry = Readonly<{
  requestId: string;
  operation: "create" | "change";
  subjectId?: string;
}>;

export type StudentCaseOperationRetry = Readonly<{
  requestId: string;
  operation: "visa" | "payment-create" | "payment-settle";
  subjectId?: string;
}>;

export type StudentCaseFinanceStopRetry = Readonly<{
  requestId: string;
  operation: "stop-create" | "stop-resolve";
  subjectId: string;
}>;

export type StudentCaseDocumentRetry = Readonly<{
  requestId: string;
  subjectId: string;
}>;

function formatTimestamp(value: string | null, locale: Locale, absent: string) {
  if (!value) return absent;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Fact({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm leading-5 text-fg-2">
        {children}
      </dd>
    </div>
  );
}

function buildRequestIdFactory(
  retry: StudentCaseContractRetry | undefined,
): ContractDraftReportRequestIdFor {
  const requestIds = new Map<string, string>();
  return (operation, subjectId) => {
    const normalizedSubjectId = subjectId ?? "";
    if (
      retry?.operation === operation &&
      (retry.subjectId ?? "") === normalizedSubjectId
    ) {
      return retry.requestId;
    }
    const key = `${operation}:${normalizedSubjectId}`;
    const current = requestIds.get(key);
    if (current) return current;
    const generated = randomUUID();
    requestIds.set(key, generated);
    return generated;
  };
}

export async function StudentCaseWorkspace({
  id,
  contractResult,
  contractRetry,
  taskFeedback,
  taskRetry,
  operationsFeedback,
  applicationRetry,
  caseOperationRetry,
  financeStopRetry,
  documentFeedback,
  documentRetry,
}: Readonly<{
  id: string;
  contractResult?: PlatformContractMutationOutcome;
  contractRetry?: StudentCaseContractRetry;
  taskFeedback?: PlatformAdmissionsTaskFeedback;
  taskRetry?: StudentCaseTaskRetry;
  operationsFeedback?: PlatformAdmissionsOperationsFeedback;
  applicationRetry?: StudentCaseApplicationRetry;
  caseOperationRetry?: StudentCaseOperationRetry;
  financeStopRetry?: StudentCaseFinanceStopRetry;
  documentFeedback?: PlatformDocumentReviewFeedback;
  documentRetry?: StudentCaseDocumentRetry;
}>) {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformAdmissionsActor("/clients"),
  ]);
  const [
    handoff,
    profile,
    contractWorkspace,
    taskWorkspace,
    applicationPage,
    visa,
    finance,
    documentWorkspace,
  ] = await Promise.all([
    getPlatformStudentCaseHandoffContext(actor, id),
    getPlatformStudentProfile(actor, id),
    getPlatformCaseContractWorkspace(actor, id),
    getPlatformAdmissionsTaskWorkspace(actor, id),
    listPlatformApplicationsForStudentCase(actor, id, { pageSize: 100 }),
    getPlatformCaseVisa(actor, id),
    getPlatformCaseFinanceControl(actor, id),
    getPlatformCaseDocumentWorkspace(actor, id),
  ]);

  if (!contractWorkspace) {
    throw new Error("The Supabase contract workspace is unavailable.");
  }
  if (handoff.caseState !== documentWorkspace.caseState) {
    throw new Error("The Supabase Admissions case state is inconsistent.");
  }

  const copy = COPY[locale];
  const admissionsCaseState = documentWorkspace.caseState;
  const requestIdFor = buildRequestIdFactory(contractRetry);
  const taskRequestIds: PlatformAdmissionsTaskRequestIds = {
    create:
      taskRetry?.operation === "create" ? taskRetry.requestId : randomUUID(),
    changes: Object.fromEntries(
      taskWorkspace.tasks.map((task) => [
        task.caseTaskId,
        taskRetry?.operation === "change" &&
        taskRetry.subjectId === task.caseTaskId
          ? taskRetry.requestId
          : randomUUID(),
      ]),
    ),
  };
  const operationsRequestIds: PlatformAdmissionsOperationsRequestIds = {
    createApplication:
      applicationRetry?.operation === "create"
        ? applicationRetry.requestId
        : randomUUID(),
    applications: Object.fromEntries(
      applicationPage.rows.map((application) => [
        application.universityApplicationId,
        applicationRetry?.operation === "change" &&
        applicationRetry.subjectId === application.universityApplicationId
          ? applicationRetry.requestId
          : randomUUID(),
      ]),
    ),
    visa:
      caseOperationRetry?.operation === "visa" &&
      (caseOperationRetry.subjectId ?? "") === (visa?.visaCaseId ?? "")
        ? caseOperationRetry.requestId
        : randomUUID(),
    createPayment:
      caseOperationRetry?.operation === "payment-create"
        ? caseOperationRetry.requestId
        : randomUUID(),
    settlePayments: Object.fromEntries(
      finance.obligations.map((obligation) => [
        obligation.paymentObligationId,
        caseOperationRetry?.operation === "payment-settle" &&
        caseOperationRetry.subjectId === obligation.paymentObligationId
          ? caseOperationRetry.requestId
          : randomUUID(),
      ]),
    ),
    createStops: Object.fromEntries(
      finance.obligations.map((obligation) => [
        obligation.paymentObligationId,
        financeStopRetry?.operation === "stop-create" &&
        financeStopRetry.subjectId === obligation.paymentObligationId
          ? financeStopRetry.requestId
          : randomUUID(),
      ]),
    ),
    resolveStops: Object.fromEntries(
      finance.obligations.flatMap((obligation) =>
        obligation.activeStopFactors.map((stop) => [
          stop.stopFactorId,
          financeStopRetry?.operation === "stop-resolve" &&
          financeStopRetry.subjectId === stop.stopFactorId
            ? financeStopRetry.requestId
            : randomUUID(),
        ]),
      ),
    ),
  };
  const documentRequestIds: PlatformDocumentRequestIds = {
    uploadBySlot: Object.fromEntries(
      documentWorkspace.slots.map((slot) => [
        slot.documentSlotId,
        randomUUID(),
      ]),
    ),
    reviewByVersion: Object.fromEntries(
      documentWorkspace.slots.flatMap((slot) =>
        slot.versions.map((version) => [
          version.documentVersionId,
          documentRetry?.subjectId === version.documentVersionId
            ? documentRetry.requestId
            : randomUUID(),
        ]),
      ),
    ),
  };
  const navigation = [
    ["case-summary", copy.summary],
    ["case-profile", copy.profile],
    ["case-handoff", copy.handoff],
    ["contract-workflow", copy.contract],
    ["case-tasks", copy.tasks],
    ["case-documents", copy.documents],
    ["applications", copy.applications],
    ["visa", copy.visa],
    ["finance", copy.finance],
    ["case-operations", copy.operations],
    ["case-amocrm", copy.amocrm],
  ] as const;

  return (
    <div className="space-y-6" data-testid="platform-student-case-workspace">
      <header className="border-b border-border pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">
          {profile?.preferredDisplayName ?? handoff.clientContext.displayName}
        </h1>
        <p className="mt-2 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
      </header>

      <nav
        aria-label={copy.sectionNavigation}
        data-testid="platform-student-case-section-navigation"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {navigation.map(([target, label]) => (
          <Link
            key={target}
            href={`#${target}`}
            className={cn(btnGhostCls, "shrink-0 whitespace-nowrap")}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section id="case-summary" className="scroll-mt-24">
        <Card title={copy.summary} className="shadow-none">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={copy.state}>{handoff.caseState}</Fact>
            <Fact label={copy.owner}>{handoff.admissionsOwnerDisplayName}</Fact>
            <Fact label={copy.handedOffAt}>
              {formatTimestamp(handoff.handedOffAt, locale, copy.absent)}
            </Fact>
            <Fact label={copy.caseId}>
              <span className="font-mono text-xs">{handoff.studentCaseId}</span>
            </Fact>
            <Fact label={copy.leadId}>
              <span className="font-mono text-xs">{handoff.leadId}</span>
            </Fact>
            <Fact label={copy.clientId}>
              <span className="font-mono text-xs">
                {handoff.clientContext.clientId}
              </span>
            </Fact>
          </dl>
        </Card>
      </section>

      <section
        id="case-profile"
        className="scroll-mt-24"
        data-testid="platform-student-profile"
        data-status={profile ? "available" : "not-created"}
      >
        <Card title={copy.profile} className="shadow-none">
          {profile ? (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label={copy.citizenship}>{profile.citizenshipCountry}</Fact>
              <Fact label={copy.residency}>{profile.residencyCountry}</Fact>
              <Fact label={copy.communicationLanguage}>
                {profile.communicationLanguage}
              </Fact>
              <Fact label={copy.education}>
                {profile.currentEducationSummary}
              </Fact>
              <Fact label={copy.academic}>{profile.academicSummary}</Fact>
              <Fact label={copy.language}>{profile.languageSummary}</Fact>
              <Fact label={copy.budget}>{profile.budgetBand}</Fact>
              <Fact label={copy.decisionParticipants}>
                {profile.decisionParticipantLabels.length > 0
                  ? profile.decisionParticipantLabels.join(", ")
                  : copy.absent}
              </Fact>
              <Fact label={copy.consent}>{profile.consentStatus}</Fact>
              <Fact label={copy.profileNextStep}>{profile.profileNextStep}</Fact>
            </dl>
          ) : (
            <p className="max-w-[56ch] text-sm leading-5 text-fg-3" role="status">
              {copy.profileNotCreated}
            </p>
          )}
        </Card>
      </section>

      <section
        id="case-handoff"
        className="scroll-mt-24 space-y-4"
        data-testid="platform-student-handoff-context"
      >
        <Card title={copy.handoff} className="shadow-none">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={copy.handoffMode}>{handoff.handoffMode}</Fact>
            <Fact label={copy.handoffState}>{handoff.handoffState}</Fact>
            <Fact label={copy.handoffReason}>
              {handoff.handoffReason ?? copy.absent}
            </Fact>
            <Fact label={copy.handoffSource}>{handoff.handoffSource}</Fact>
            <Fact label={copy.gateState}>{handoff.gateState}</Fact>
            <Fact label={copy.gateVersion}>{handoff.gateVersion}</Fact>
            <Fact label={copy.caseId}>
              <span className="font-mono text-xs">{handoff.studentCaseId}</span>
            </Fact>
            <Fact label={copy.leadId}>
              <span className="font-mono text-xs">{handoff.leadId}</span>
            </Fact>
            <Fact label={copy.owner}>
              {handoff.admissionsOwnerDisplayName}
            </Fact>
            <Fact label={copy.executedBy}>{handoff.actorDisplayName}</Fact>
            <Fact label={copy.handedOffAt}>
              {formatTimestamp(handoff.handedOffAt, locale, copy.absent)}
            </Fact>
            <Fact label={copy.inheritedSales}>
              {[handoff.salesContext.stageKey, handoff.salesContext.sourceKey]
                .filter(Boolean)
                .join(" · ") || copy.absent}
            </Fact>
          </dl>
        </Card>

        <section className="border-t border-border pt-5">
          <h2 className="text-base font-semibold text-fg">
            {copy.starterTasks}
          </h2>
          {handoff.starterTasks.length === 0 ? (
            <p className="mt-3 text-sm text-fg-3">{copy.noStarterTasks}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {handoff.starterTasks.map((task) => (
                <li
                  key={task.taskId}
                  className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
                  data-testid="platform-admissions-starter-task"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{task.title}</p>
                    <p className="mt-1 text-xs text-fg-3">
                      {task.assigneeDisplayName} · {task.priority}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-fg-2">
                    {task.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <ContractDraftReportWorkspace
        workspace={contractWorkspace}
        actions={CONTRACT_ACTIONS}
        requestIdFor={requestIdFor}
        result={contractResult}
        retrySubjectId={contractRetry?.subjectId}
      />

      <section id="case-tasks" className="scroll-mt-24">
        <PlatformAdmissionsTaskPanel
          locale={locale}
          tasks={taskWorkspace.tasks}
          assignees={taskWorkspace.assignees}
          actorMembershipId={actor.membershipId}
          authorityRole={actor.authorityRole}
          presentationRole={actor.presentationRole}
          requestIds={taskRequestIds}
          createForCase={{ studentCaseId: id }}
          caseState={admissionsCaseState}
          feedback={taskFeedback}
        />
      </section>

      <PlatformPrivateDocumentsPanel
        locale={locale}
        presentationRole={actor.presentationRole}
        workspace={documentWorkspace}
        requestIds={documentRequestIds}
        reviewFeedback={documentFeedback}
      />

      <PlatformAdmissionsOperationsPanel
        locale={locale}
        studentCaseId={id}
        studentCaseState={admissionsCaseState}
        authorityRole={actor.authorityRole}
        presentationRole={actor.presentationRole}
        applications={applicationPage.rows}
        visa={visa}
        finance={finance}
        requestIds={operationsRequestIds}
        feedback={operationsFeedback}
      />

      <CanonicalAmoCrmCommandSection
        organizationId={actor.organizationId}
        authorityRole={actor.authorityRole}
        locale={locale}
        studentCaseId={id}
        leadId={handoff.leadId}
        clientId={handoff.clientContext.clientId}
        caseState={handoff.caseState}
      />
    </div>
  );
}
