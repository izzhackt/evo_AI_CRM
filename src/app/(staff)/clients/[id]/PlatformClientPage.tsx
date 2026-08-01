import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ContextBanner,
  DetailBackLink,
  KeyValueGrid,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";
import {
  Badge,
  Card,
  PageHeader,
  btnCls,
  inputCls,
  labelCls,
} from "@/components/ui";
import { changePlatformStudentCaseStateAction } from "@/lib/platform-admissions-actions";
import {
  getPlatformStudentCaseView,
  listPlatformApplications,
  parsePlatformAdmissionsUuid,
} from "@/lib/platform-admissions";
import { requirePlatformClientsActor } from "@/lib/platform-guards";

function resultBanner(result: string | undefined) {
  if (result === "saved") {
    return (
      <ContextBanner
        tone="info"
        title="Изменение сохранено"
        description="Состояние записано через аудируемую операцию EVO Platform."
      />
    );
  }
  if (result === "invalid") {
    return (
      <ContextBanner
        tone="danger"
        title="Проверьте данные"
        description="Причина обязательна, а выбранное действие должно соответствовать вашей роли."
      />
    );
  }
  if (result === "unavailable") {
    return (
      <ContextBanner
        tone="danger"
        title="Изменение не выполнено"
        description="Сервер не подтвердил запись. Данные не считаются изменёнными."
      />
    );
  }
  return null;
}

export default async function PlatformClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string; retry_request_id?: string }>;
}) {
  const [actor, { id }, query] = await Promise.all([
    requirePlatformClientsActor(),
    params,
    searchParams,
  ]);
  const view = await getPlatformStudentCaseView(actor, id);
  if (!view) notFound();

  if (view.access === "sales_summary") {
    const summary = view.studentCase;
    return (
      <div className="space-y-5" data-testid="platform-sales-handoff-summary">
        <DetailBackLink href="/clients" label="К списку студентов" />
        {resultBanner(query.result)}
        <PageHeader
          eyebrow="Безопасное резюме после handoff"
          title={summary.studentDisplayName}
          description="После передачи куратору Sales не получает документы, финансы, сообщения или внутренние операционные поля."
        />
        <ContextBanner
          title="Доступ Sales ограничен"
          description="Полная работа продолжилась у назначенного куратора; история передачи сохранена."
        />
        <Card title="Разрешённые сведения">
          <KeyValueGrid
            items={[
              { label: "Страна", value: summary.targetCountry },
              { label: "Уровень", value: summary.targetDegree },
              {
                label: "Состояние кейса",
                value: <Badge value={summary.state} label={summary.state} />,
              },
              { label: "Куратор", value: summary.assignedCuratorDisplayName },
              {
                label: "Передано",
                value: new Date(summary.handoffAt).toLocaleString("ru-RU"),
              },
            ]}
          />
        </Card>
      </div>
    );
  }

  const studentCase = view.studentCase;
  const applications = await listPlatformApplications(actor);
  const caseApplications = applications.filter(
    (item) => item.studentCaseId === studentCase.studentCaseId,
  );
  const canChangeLifecycle =
    (actor.platformRole === "admin" || actor.platformRole === "curator") &&
    (studentCase.state === "active" || studentCase.state === "closed");
  const nextState = studentCase.state === "closed" ? "active" : "closed";
  const lifecycleRequestId =
    parsePlatformAdmissionsUuid(query.retry_request_id) ?? randomUUID();

  return (
    <div className="space-y-5" data-testid="platform-client-detail-page">
      <DetailBackLink href="/clients" label="К списку студентов" />
      {resultBanner(query.result)}
      <PageHeader
        eyebrow="Student 360 · OZO"
        title={studentCase.studentDisplayName}
        description={`${studentCase.targetCountry} · ${studentCase.targetDegree}`}
        action={<Badge value={studentCase.state} label={studentCase.state} />}
      />

      {!studentCase.appliedOzoWorkflowContractVersionId && (
        <ContextBanner
          tone="warning"
          title="Версия OZO ещё не привязана"
          description="Кейс доступен, но переходы по утверждённому OZO-контракту остаются заблокированы до явной привязки версии."
        />
      )}

      <QueueMetrics
        items={[
          {
            label: "Заявки",
            value: caseApplications.length,
            tone: "accent",
          },
          {
            label: "Просроченные задачи",
            value: studentCase.overdueTaskCount,
            tone: studentCase.overdueTaskCount > 0 ? "danger" : "ok",
          },
          {
            label: "Просроченные оплаты",
            value: studentCase.overdueObligationCount,
            tone: studentCase.overdueObligationCount > 0 ? "danger" : "ok",
          },
          {
            label: "Документы на доработке",
            value: studentCase.rejectedDocumentCount,
            tone: studentCase.rejectedDocumentCount > 0 ? "warn" : "ok",
          },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="space-y-5">
          <Card title="Маршрут и ответственность">
            <KeyValueGrid
              items={[
                { label: "Операционный этап", value: studentCase.operationalStage },
                { label: "Статус маршрута", value: studentCase.routeApprovalStatus },
                { label: "Направление", value: studentCase.programDirection },
                { label: "Набор", value: studentCase.intake },
                { label: "Sales", value: studentCase.responsibleSalesDisplayName },
                { label: "Куратор", value: studentCase.currentCuratorDisplayName },
                { label: "Следующее действие", value: studentCase.nextAction },
                { label: "Язык", value: studentCase.languageAssumption },
                { label: "Финансирование", value: studentCase.fundingAssumption },
              ]}
            />
          </Card>

          <Card title="OP → OZO handoff">
            {studentCase.handoff ? (
              <div className="space-y-5">
                <KeyValueGrid
                  items={[
                    { label: "Следующий шаг", value: studentCase.handoff.nextStep },
                    {
                      label: "Срок",
                      value: new Date(studentCase.handoff.dueAt).toLocaleString("ru-RU"),
                    },
                    { label: "Ответственная роль", value: studentCase.handoff.responsibleRole },
                    {
                      label: "Создан",
                      value: new Date(studentCase.handoff.createdAt).toLocaleString("ru-RU"),
                    },
                  ]}
                />
                <div className="grid gap-4 lg:grid-cols-3">
                  <section>
                    <h3 className="text-[12px] font-bold text-fg">Коммерческие поля</h3>
                    <ul className="mt-2 space-y-1 text-[12px] text-fg-2">
                      {Object.entries(studentCase.handoff.approvedCommercialFields).map(
                        ([key, item]) => (
                          <li key={key}>
                            <span className="font-medium">{key}:</span> {String(item ?? "—")}
                          </li>
                        ),
                      )}
                    </ul>
                  </section>
                  <section>
                    <h3 className="text-[12px] font-bold text-fg">Открытые вопросы</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] text-fg-2">
                      {studentCase.handoff.unresolvedQuestions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3 className="text-[12px] font-bold text-fg">Обещания</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] text-fg-2">
                      {studentCase.handoff.promises.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>
            ) : (
              <ContextBanner
                tone="warning"
                title="Handoff payload отсутствует"
                description="Существующий кейс не получил версионированную передачу. Поля не восстанавливаются догадкой."
              />
            )}
          </Card>

          <Card
            title="Заявки в университеты"
            action={
              <Link href="/applications#add" className={btnCls}>
                Добавить заявку
              </Link>
            }
          >
            {caseApplications.length === 0 ? (
              <p className="text-[13px] text-fg-3">Заявок пока нет.</p>
            ) : (
              <ul role="list" className="divide-y divide-border">
                {caseApplications.map((application) => (
                  <li key={application.universityApplicationId}>
                    <Link
                      href={`/applications/${application.universityApplicationId}`}
                      className="flex items-center justify-between gap-3 py-3 hover:text-accent"
                    >
                      <span>
                        <strong className="block text-[13px] text-fg">
                          {application.institutionName}
                        </strong>
                        <span className="text-[11.5px] text-fg-3">
                          {application.programName}
                        </span>
                      </span>
                      <Badge value={application.status} label={application.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          {studentCase.state === "pending" && (
            <ContextBanner
              tone="warning"
              title="Ожидает назначения куратора"
              description="Портал активируется только после подтверждённого договора и назначения куратора администратором."
            />
          )}

          {canChangeLifecycle && (
            <Card title={nextState === "closed" ? "Закрыть кейс" : "Переоткрыть кейс"}>
              <form action={changePlatformStudentCaseStateAction} className="space-y-3">
                <input type="hidden" name="student_case_id" value={studentCase.studentCaseId} />
                <input type="hidden" name="request_id" value={lifecycleRequestId} />
                <input type="hidden" name="new_state" value={nextState} />
                <label className={labelCls} htmlFor="platform-case-lifecycle-reason">
                  Причина изменения
                </label>
                <textarea
                  id="platform-case-lifecycle-reason"
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={4}
                  className={`${inputCls} h-auto py-3`}
                />
                <button type="submit" className={btnCls}>
                  {nextState === "closed" ? "Закрыть с аудитом" : "Переоткрыть с аудитом"}
                </button>
              </form>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
