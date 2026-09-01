import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CanonicalAdmissionsOperationsPanel,
  type CanonicalAdmissionsOperationsRequestIds,
} from "@/components/platform/admissions/CanonicalAdmissionsOperationsPanel";
import {
  CanonicalAdmissionsTaskPanel,
  type CanonicalAdmissionsTaskRequestIds,
} from "@/components/platform/admissions/CanonicalAdmissionsTaskPanel";
import { CanonicalAmoCrmCommandPanel } from "@/components/platform/amocrm/CanonicalAmoCrmCommandPanel";
import { CanonicalPrivateDocumentsPanel } from "@/components/platform/documents/CanonicalPrivateDocumentsPanel";
import { btnGhostCls, Card, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { getT } from "@/lib/i18n";
import { requirePlatformAdmissionsActor } from "@/lib/platform-guards";
import { readCanonicalAmoCrmCommandAvailability } from "@/lib/server/canonical-amocrm-command-actions";
import { readBlockingCanonicalAmoCrmCommand } from "@/lib/server/canonical-amocrm-command-repository";
import {
  CanonicalCrmRepositoryError,
  getCanonicalAdmissionsOperationsSnapshot,
  getCanonicalStudentCaseHandoffSnapshot,
  getCanonicalStudentCaseSnapshot,
  listCanonicalAdmissionsTasks,
} from "@/lib/server/canonical-crm-repository";
import {
  listPrivateDocumentsForCase,
  PrivateDocumentRepositoryError,
} from "@/lib/server/private-document-repository";

const COPY = {
  ru: {
    title: "Кейс студента",
    description:
      "Это минимальный канонический контекст после передачи из Sales. Все данные прочитаны из PostgreSQL EVO V2.",
    status: "Статус",
    assignedRole: "Ответственная роль",
    caseId: "ID кейса",
    leadId: "ID лида",
    createdAt: "Создан",
    updatedAt: "Обновлён",
    handoff: "Контекст передачи",
    normal: "Обычная передача",
    override: "Исключение Admin",
    overrideReason: "Причина исключения",
    executedBy: "Выполнила роль",
    executedAt: "Время передачи",
    contractEvidence: "Доказательство договора",
    paymentEvidence: "Доказательство первого платежа",
    absent: "Нет",
    starterTasks: "Стартовые задачи Admissions",
    noTasks: "Стартовые задачи не созданы.",
    taskOpen: "Открыта",
    taskCompleted: "Завершена",
    taskCancelled: "Отменена",
    sectionNavigation: "Разделы кейса",
    summaryNavigation: "Обзор",
    handoffNavigation: "Передача",
    tasksNavigation: "Задачи",
    documentsNavigation: "Документы",
    amocrmNavigation: "amoCRM",
    operationsNavigation: "Заявки, виза и финансы",
  },
  ky: {
    title: "Студенттин кейси",
    description:
      "Бул Sales бөлүмүнөн өткөрүлгөндөн кийинки минималдуу каноникалык контекст. Бардык маалымат EVO V2 PostgreSQL базасынан окулду.",
    status: "Абалы",
    assignedRole: "Жооптуу роль",
    caseId: "Кейс ID",
    leadId: "Лид ID",
    createdAt: "Түзүлдү",
    updatedAt: "Жаңыртылды",
    handoff: "Өткөрүү контексти",
    normal: "Кадимки өткөрүү",
    override: "Admin өзгөчө чечими",
    overrideReason: "Өзгөчө чечимдин себеби",
    executedBy: "Аткарган роль",
    executedAt: "Өткөрүү убактысы",
    contractEvidence: "Келишим далили",
    paymentEvidence: "Биринчи төлөм далили",
    absent: "Жок",
    starterTasks: "Admissions баштапкы тапшырмалары",
    noTasks: "Баштапкы тапшырмалар түзүлгөн жок.",
    taskOpen: "Ачык",
    taskCompleted: "Аяктады",
    taskCancelled: "Жокко чыгарылды",
    sectionNavigation: "Кейс бөлүмдөрү",
    summaryNavigation: "Обзор",
    handoffNavigation: "Өткөрүү",
    tasksNavigation: "Тапшырмалар",
    documentsNavigation: "Документтер",
    amocrmNavigation: "amoCRM",
    operationsNavigation: "Арыздар, виза жана каржы",
  },
  en: {
    title: "Student case",
    description:
      "This is the minimal canonical context after Sales handoff. Every value is read from EVO V2 PostgreSQL.",
    status: "Status",
    assignedRole: "Assigned role",
    caseId: "Case ID",
    leadId: "Lead ID",
    createdAt: "Created",
    updatedAt: "Updated",
    handoff: "Handoff context",
    normal: "Normal handoff",
    override: "Admin exception",
    overrideReason: "Exception reason",
    executedBy: "Executed by role",
    executedAt: "Handoff time",
    contractEvidence: "Contract evidence",
    paymentEvidence: "First-payment evidence",
    absent: "None",
    starterTasks: "Admissions starter tasks",
    noTasks: "No starter tasks were created.",
    taskOpen: "Open",
    taskCompleted: "Completed",
    taskCancelled: "Cancelled",
    sectionNavigation: "Case sections",
    summaryNavigation: "Overview",
    handoffNavigation: "Handoff",
    tasksNavigation: "Tasks",
    documentsNavigation: "Documents",
    amocrmNavigation: "amoCRM",
    operationsNavigation: "Applications, visa and finance",
  },
} as const;

function formatTimestamp(value: string, locale: Locale): string {
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
      <dd className="mt-1.5 break-words text-sm text-fg-2">{children}</dd>
    </div>
  );
}

export async function CanonicalStudentCaseWorkspace({
  id,
}: Readonly<{ id: string }>) {
  const [{ locale }, actor, amoCrmAvailability] = await Promise.all([
    getT(),
    requirePlatformAdmissionsActor("/clients"),
    readCanonicalAmoCrmCommandAvailability(),
  ]);

  let studentCase: Awaited<ReturnType<typeof getCanonicalStudentCaseSnapshot>>;
  let handoff: Awaited<
    ReturnType<typeof getCanonicalStudentCaseHandoffSnapshot>
  >;
  let tasksPage: Awaited<ReturnType<typeof listCanonicalAdmissionsTasks>>;
  let operations: Awaited<
    ReturnType<typeof getCanonicalAdmissionsOperationsSnapshot>
  >;
  let documents: Awaited<ReturnType<typeof listPrivateDocumentsForCase>>;
  try {
    [studentCase, handoff, tasksPage, operations, documents] = await Promise.all([
      getCanonicalStudentCaseSnapshot({
        actorRole: actor.platformRole,
        studentCaseId: id,
      }),
      getCanonicalStudentCaseHandoffSnapshot({
        actorRole: actor.platformRole,
        studentCaseId: id,
      }),
      listCanonicalAdmissionsTasks({
        actorRole: actor.platformRole,
        studentCaseId: id,
        pageSize: 50,
      }),
      getCanonicalAdmissionsOperationsSnapshot({
        actorRole: actor.platformRole,
        studentCaseId: id,
      }),
      listPrivateDocumentsForCase({
        actorRole: actor.platformRole,
        caseId: id,
      }),
    ]);
  } catch (error: unknown) {
    if (
      ((error instanceof CanonicalCrmRepositoryError &&
        error.code === "not_found") ||
        (error instanceof PrivateDocumentRepositoryError &&
          error.code === "not_found"))
    ) {
      notFound();
    }
    throw error;
  }
  const blockingAmoCrmAttempt =
    studentCase.status !== "active" || studentCase.assignedRole !== "admissions"
      ? null
      : await readBlockingCanonicalAmoCrmCommand({
          authorization: {
            actorRole: actor.platformRole,
            workflowScope: "admissions_post_handoff",
            workflowLeadId: studentCase.leadId,
            studentCaseId: studentCase.studentCaseId,
          },
          personId: studentCase.personId,
          leadId: studentCase.leadId,
        });

  const copy = COPY[locale];
  const transitionRequestIds: CanonicalAdmissionsTaskRequestIds =
    Object.fromEntries(
      tasksPage.rows.map((task) => [
        task.taskId,
        Object.freeze({ complete: randomUUID(), cancel: randomUUID() }),
      ]),
    );
  const operationRequestIds: CanonicalAdmissionsOperationsRequestIds = {
    createApplication: randomUUID(),
    applications: Object.fromEntries(
      operations.applications.map((application) => [
        application.applicationId,
        Object.freeze({
          update: randomUUID(),
          submitted: randomUUID(),
          accepted: randomUUID(),
          rejected: randomUUID(),
          withdrawn: randomUUID(),
        }),
      ]),
    ),
    visaMilestones: Object.fromEntries(
      operations.visaMilestones.map((milestone) => [
        milestone.visaMilestoneId,
        Object.freeze({
          in_progress: randomUUID(),
          completed: randomUUID(),
          blocked: randomUUID(),
        }),
      ]),
    ),
    finance: Object.freeze({ assert: randomUUID(), release: randomUUID() }),
  };
  return (
    <div className="space-y-5" data-testid="canonical-student-case-workspace">
      <header className="border-b border-border pb-5">
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          {studentCase.displayName}
        </h1>
        <p className="mt-2 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
      </header>

      <nav
        aria-label={copy.sectionNavigation}
        data-testid="canonical-student-case-section-navigation"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {[
          ["case-summary", copy.summaryNavigation],
          ["case-handoff", copy.handoffNavigation],
          ["case-tasks", copy.tasksNavigation],
          ["case-documents", copy.documentsNavigation],
          ["case-amocrm", copy.amocrmNavigation],
          ["case-operations", copy.operationsNavigation],
        ].map(([target, label]) => (
          <Link
            key={target}
            href={`#${target}`}
            className={cn(btnGhostCls, "shrink-0 whitespace-nowrap")}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div id="case-summary" className="scroll-mt-24">
        <Card title={copy.title} className="shadow-none">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={copy.status}>
            <span className="font-medium text-fg">{studentCase.status}</span>
          </Fact>
          <Fact label={copy.assignedRole}>{studentCase.assignedRole}</Fact>
          <Fact label={copy.caseId}>
            <span className="font-mono text-xs">
              {studentCase.studentCaseId}
            </span>
          </Fact>
          <Fact label={copy.leadId}>
            <span className="font-mono text-xs">
              {studentCase.leadId}
            </span>
          </Fact>
          <Fact label={copy.createdAt}>
            {formatTimestamp(studentCase.createdAt, locale)}
          </Fact>
          <Fact label={copy.updatedAt}>
            {formatTimestamp(studentCase.updatedAt, locale)}
          </Fact>
          </dl>
        </Card>
      </div>

      <div id="case-handoff" className="scroll-mt-24">
        <Card title={copy.handoff} className="shadow-none">
          <dl
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="canonical-student-case-handoff"
          >
          <Fact label={copy.handoff}>
            <span
              className={cn(
                "font-medium",
                handoff.handoff.isOverride ? "text-warn" : "text-ok",
              )}
            >
              {handoff.handoff.isOverride ? copy.override : copy.normal}
            </span>
          </Fact>
          <Fact label={copy.executedBy}>{handoff.handoff.executedByRole}</Fact>
          <Fact label={copy.executedAt}>
            {formatTimestamp(handoff.handoff.executedAt, locale)}
          </Fact>
          {handoff.handoff.isOverride ? (
            <Fact label={copy.overrideReason}>
              <span data-testid="canonical-handoff-override-reason">
                {handoff.handoff.overrideReason}
              </span>
            </Fact>
          ) : null}
          <Fact label={copy.contractEvidence}>
            <span className="font-mono text-xs">
              {handoff.handoff.contractEvidenceId ?? copy.absent}
            </span>
          </Fact>
          <Fact label={copy.paymentEvidence}>
            <span className="font-mono text-xs">
              {handoff.handoff.firstPaymentEvidenceId ?? copy.absent}
            </span>
          </Fact>
          </dl>
        </Card>
      </div>

      <div id="case-tasks" className="scroll-mt-24 space-y-5">
        <section className="border-t border-border pt-5">
          <h2 className="text-base font-semibold text-fg">
            {copy.starterTasks}
          </h2>
          {handoff.starterTasks.length === 0 ? (
            <p className="mt-3 text-sm text-fg-3">{copy.noTasks}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {handoff.starterTasks.map((task) => (
                <li
                  key={task.taskId}
                  className="flex gap-4 py-3"
                  data-testid="canonical-admissions-starter-task"
                >
                  <span
                    className={cn(
                      "mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold",
                      task.status === "completed"
                        ? "bg-ok-weak text-ok"
                        : task.status === "cancelled"
                          ? "bg-surface-2 text-fg-3"
                          : "bg-info-weak text-info",
                    )}
                  >
                    {task.status === "completed"
                      ? copy.taskCompleted
                      : task.status === "cancelled"
                        ? copy.taskCancelled
                        : copy.taskOpen}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">
                      {task.title}
                    </p>
                    {task.details ? (
                      <p className="mt-1 max-w-[56ch] whitespace-pre-wrap text-sm leading-5 text-fg-3">
                        {task.details}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <CanonicalAdmissionsTaskPanel
          locale={locale}
          tasks={tasksPage.rows}
          transitionRequestIds={transitionRequestIds}
          create={
            studentCase.status === "active"
              ? { studentCaseId: id, requestId: randomUUID() }
              : undefined
          }
          hasNext={tasksPage.hasNext}
        />
      </div>

      <div id="case-documents" className="scroll-mt-24">
        <CanonicalPrivateDocumentsPanel
          locale={locale}
          caseId={id}
          caseStatus={studentCase.status}
          documents={documents}
        />
      </div>

      <div id="case-amocrm" className="scroll-mt-24">
        <CanonicalAmoCrmCommandPanel
          availability={amoCrmAvailability}
          blockingAttempt={
            blockingAmoCrmAttempt === null
              ? null
              : {
                  attemptId: blockingAmoCrmAttempt.attemptId,
                  operationName: blockingAmoCrmAttempt.operationName,
                  status: blockingAmoCrmAttempt.status as "prepared" | "unknown",
                  providerDispatchedAt:
                    blockingAmoCrmAttempt.providerDispatchedAt,
                }
          }
          scope="admissions"
          leadId={studentCase.leadId}
          studentCaseId={studentCase.studentCaseId}
          locale={locale}
          requestId={randomUUID()}
        />
      </div>

      <div id="case-operations" className="scroll-mt-24">
        <CanonicalAdmissionsOperationsPanel
          locale={locale}
          actorRole={actor.platformRole}
          studentCaseId={id}
          studentCaseStatus={operations.studentCase.status}
          applications={operations.applications}
          visaMilestones={operations.visaMilestones}
          financeStop={operations.financeStop}
          requestIds={operationRequestIds}
        />
      </div>
    </div>
  );
}
