import { randomUUID } from "node:crypto";

import Link from "next/link";

import {
  ContextBanner,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";
import {
  Badge,
  EmptyState,
  PageHeader,
  btnCls,
  btnGhostCls,
  cn,
  filterBarCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { createPlatformUniversityApplicationAction } from "@/lib/platform-admissions-actions";
import {
  PLATFORM_APPLICATION_STATUSES,
  listPlatformApplications,
  listPlatformStudentCases,
  parsePlatformAdmissionsUuid,
  type PlatformApplicationStatus,
} from "@/lib/platform-admissions";
import { requirePlatformApplicationsActor } from "@/lib/platform-guards";

const STATUS_COPY: Record<PlatformApplicationStatus, string> = {
  preparation: "Подготовка",
  ready: "Готова к подаче",
  submitted: "Подана",
  under_review: "На рассмотрении",
  offer: "Получен offer",
  rejected: "Отказ",
  enrolled: "Зачислен",
  withdrawn: "Отозвана",
  closed: "Закрыта",
};

function resultBanner(result: string | undefined) {
  if (result === "saved") {
    return (
      <ContextBanner
        tone="info"
        title="Заявка сохранена"
        description="Операция подтверждена EVO Platform и записана в аудит."
      />
    );
  }
  if (result === "invalid") {
    return (
      <ContextBanner
        tone="danger"
        title="Проверьте данные заявки"
        description="Для внешних статусов обязательна ссылка или идентификатор подтверждающего evidence."
      />
    );
  }
  if (result === "unavailable") {
    return (
      <ContextBanner
        tone="danger"
        title="Заявка не сохранена"
        description="Сервер не подтвердил запись. Повторите после проверки доступа и соединения."
      />
    );
  }
  return null;
}

export default async function PlatformApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    result?: string;
    student_case_id?: string;
    retry_request_id?: string;
  }>;
}) {
  const [actor, query] = await Promise.all([
    requirePlatformApplicationsActor(),
    searchParams,
  ]);
  const [applications, studentCases] = await Promise.all([
    listPlatformApplications(actor),
    listPlatformStudentCases(actor),
  ]);
  const selectedStatus = (
    PLATFORM_APPLICATION_STATUSES as readonly string[]
  ).includes(query.status ?? "")
    ? (query.status as PlatformApplicationStatus)
    : undefined;
  const visibleApplications = selectedStatus
    ? applications.filter((item) => item.status === selectedStatus)
    : applications;
  const selectedCase = studentCases.cases.some(
    (item) => item.studentCaseId === query.student_case_id,
  )
    ? query.student_case_id
    : studentCases.cases[0]?.studentCaseId;
  const createRequestId =
    parsePlatformAdmissionsUuid(query.retry_request_id) ?? randomUUID();

  return (
    <div className="space-y-5" data-testid="platform-applications-page">
      <PageHeader
        eyebrow="OZO · admissions"
        title="Заявки в университеты"
        description="У одного студента может быть несколько параллельных заявок. Внешнее решение фиксируется только с подтверждением."
      />
      {resultBanner(query.result)}

      <QueueMetrics
        items={[
          { label: "Всего доступно", value: applications.length, tone: "accent" },
          {
            label: "В подготовке",
            value: applications.filter((item) =>
              ["preparation", "ready"].includes(item.status),
            ).length,
            tone: "warn",
          },
          {
            label: "На рассмотрении",
            value: applications.filter((item) =>
              ["submitted", "under_review"].includes(item.status),
            ).length,
            tone: "info",
          },
          {
            label: "Требуют задач",
            value: applications.filter((item) => item.openTaskCount > 0).length,
            tone: "danger",
          },
        ]}
      />

      <form className={cn(filterBarCls, "sm:grid-cols-[1fr_auto]")}>
        <label className="sr-only" htmlFor="platform-application-status-filter">
          Статус заявки
        </label>
        <select
          id="platform-application-status-filter"
          name="status"
          defaultValue={selectedStatus ?? ""}
          className={inputCls}
        >
          <option value="">Все статусы</option>
          {PLATFORM_APPLICATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_COPY[status]}
            </option>
          ))}
        </select>
        <button type="submit" className={btnGhostCls}>
          Применить
        </button>
      </form>

      {visibleApplications.length === 0 ? (
        <div className="rounded-card border border-border bg-surface shadow-evo">
          <EmptyState text="Заявок по выбранному фильтру нет." />
        </div>
      ) : (
        <ul role="list" className="grid gap-3 lg:grid-cols-2">
          {visibleApplications.map((application) => (
            <li key={application.universityApplicationId}>
              <Link
                href={`/applications/${application.universityApplicationId}`}
                className="block h-full rounded-card border border-border bg-surface p-4 shadow-evo hover:border-border-strong"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span>
                    <strong className="block text-[14px] text-fg">
                      {application.institutionName}
                    </strong>
                    <span className="mt-1 block text-[12px] text-fg-2">
                      {application.programName}
                    </span>
                  </span>
                  <Badge
                    value={application.status}
                    label={STATUS_COPY[application.status]}
                  />
                </div>
                <p className="mt-3 text-[12px] text-fg-2">
                  {application.studentDisplayName} · {application.targetCountry}
                </p>
                <p className="mt-2 text-[11.5px] text-fg-3">
                  Открытые задачи: {application.openTaskCount} · Документы в работе: {application.openDocumentCount}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <details id="add" className="rounded-card border border-border bg-surface shadow-evo">
        <summary className="cursor-pointer px-5 py-4 text-[13px] font-bold text-fg">
          Добавить университетскую заявку
        </summary>
        <div className="border-t border-border p-5">
          {studentCases.cases.length === 0 ? (
            <ContextBanner
              tone="warning"
              title="Нет доступного студенческого кейса"
              description="Сначала нужен подтверждённый и доступный вашей роли кейс. Локальный клиент не создаётся."
            />
          ) : (
            <form
              action={createPlatformUniversityApplicationAction}
              className="grid gap-4 lg:grid-cols-2"
            >
              <input type="hidden" name="request_id" value={createRequestId} />
              <label className={labelCls}>
                Студент
                <select
                  name="student_case_id"
                  required
                  defaultValue={selectedCase}
                  className={`${inputCls} mt-1`}
                >
                  {studentCases.cases.map((studentCase) => (
                    <option key={studentCase.studentCaseId} value={studentCase.studentCaseId}>
                      {studentCase.studentDisplayName} · {studentCase.targetCountry}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Начальный статус
                <select name="status" defaultValue="preparation" className={`${inputCls} mt-1`}>
                  {PLATFORM_APPLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_COPY[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Университет
                <input
                  name="institution_name"
                  required
                  maxLength={300}
                  className={`${inputCls} mt-1`}
                />
              </label>
              <label className={labelCls}>
                Программа
                <input
                  name="program_name"
                  required
                  maxLength={300}
                  className={`${inputCls} mt-1`}
                />
              </label>
              <label className={cn(labelCls, "lg:col-span-2")}>
                Evidence для внешнего статуса
                <input
                  name="evidence_reference"
                  maxLength={1000}
                  placeholder="Ссылка или проверяемый идентификатор"
                  className={`${inputCls} mt-1`}
                />
                <span className="mt-1 block text-[11px] font-normal text-fg-3">
                  Обязательно для submitted, under_review, offer, rejected и enrolled.
                </span>
              </label>
              <label className={cn(labelCls, "lg:col-span-2")}>
                Примечание
                <textarea
                  name="note"
                  maxLength={1000}
                  rows={3}
                  className={`${inputCls} mt-1 h-auto py-3`}
                />
              </label>
              <div className="lg:col-span-2">
                <button type="submit" className={btnCls}>
                  Создать с аудитом
                </button>
              </div>
            </form>
          )}
        </div>
      </details>
    </div>
  );
}
