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
import { changePlatformUniversityApplicationAction } from "@/lib/platform-admissions-actions";
import {
  PLATFORM_APPLICATION_STATUSES,
  getPlatformApplication,
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
        title="Статус сохранён"
        description="Изменение и evidence записаны через аудируемую операцию EVO Platform."
      />
    );
  }
  if (result === "invalid") {
    return (
      <ContextBanner
        tone="danger"
        title="Проверьте статус и evidence"
        description="Внешние статусы нельзя сохранить без проверяемого подтверждения."
      />
    );
  }
  if (result === "unavailable") {
    return (
      <ContextBanner
        tone="danger"
        title="Изменение не подтверждено"
        description="EVO Platform не считает статус изменённым. Повторите после проверки соединения."
      />
    );
  }
  return null;
}

export default async function PlatformApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string; retry_request_id?: string }>;
}) {
  const [actor, { id }, query] = await Promise.all([
    requirePlatformApplicationsActor(),
    params,
    searchParams,
  ]);
  const application = await getPlatformApplication(actor, id);
  if (!application) notFound();
  const statusRequestId =
    parsePlatformAdmissionsUuid(query.retry_request_id) ?? randomUUID();

  return (
    <div className="space-y-5" data-testid="platform-application-detail-page">
      <DetailBackLink href="/applications" label="К очереди заявок" />
      {resultBanner(query.result)}
      <PageHeader
        eyebrow="University application"
        title={application.institutionName}
        description={`${application.programName} · ${application.studentDisplayName}`}
        action={
          <Badge
            value={application.status}
            label={STATUS_COPY[application.status]}
          />
        }
      />

      <QueueMetrics
        items={[
          { label: "Документы", value: application.documentCount, tone: "accent" },
          {
            label: "Документы в работе",
            value: application.openDocumentCount,
            tone: application.openDocumentCount > 0 ? "warn" : "ok",
          },
          { label: "Открытые задачи", value: application.openTaskCount, tone: "info" },
          {
            label: "Непогашенные обязательства",
            value: application.outstandingPaymentObligationCount,
            tone:
              application.outstandingPaymentObligationCount > 0
                ? "danger"
                : "ok",
          },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
        <div className="space-y-5">
          <Card title="Сведения о заявке">
            <KeyValueGrid
              items={[
                { label: "Студент", value: application.studentDisplayName },
                { label: "Страна", value: application.targetCountry },
                { label: "Уровень", value: application.targetDegree },
                { label: "Направление", value: application.programDirection },
                { label: "Набор", value: application.intake },
                { label: "Sales", value: application.responsibleSalesDisplayName },
                { label: "Куратор", value: application.currentCuratorDisplayName },
                {
                  label: "Evidence",
                  value: application.latestEvidenceReference ?? "Не требуется для текущего статуса",
                },
                {
                  label: "Обновлено",
                  value: new Date(application.updatedAt).toLocaleString("ru-RU"),
                },
              ]}
            />
            <Link
              href={`/clients/${application.studentCaseId}`}
              className={`${btnCls} mt-4`}
            >
              Открыть Student 360
            </Link>
          </Card>

          <ContextBanner
            title="Внешнее решение не гарантируется"
            description="EVO фиксирует проверяемый факт и выполнение собственных обязательств, но не гарантирует admission, scholarship или решение внешнего органа."
          />
        </div>

        <aside>
          <Card title="Изменить статус">
            <form
              action={changePlatformUniversityApplicationAction}
              className="space-y-4"
            >
              <input
                type="hidden"
                name="application_id"
                value={application.universityApplicationId}
              />
              <input type="hidden" name="request_id" value={statusRequestId} />
              <label className={labelCls}>
                Новый статус
                <select
                  name="status"
                  defaultValue={application.status}
                  className={`${inputCls} mt-1`}
                >
                  {PLATFORM_APPLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_COPY[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                Evidence
                <input
                  name="evidence_reference"
                  defaultValue={application.latestEvidenceReference ?? ""}
                  maxLength={1000}
                  placeholder="Ссылка или проверяемый идентификатор"
                  className={`${inputCls} mt-1`}
                />
                <span className="mt-1 block text-[11px] font-normal text-fg-3">
                  Обязательно для submitted, under_review, offer, rejected и enrolled.
                </span>
              </label>
              <label className={labelCls}>
                Примечание
                <textarea
                  name="note"
                  maxLength={1000}
                  rows={4}
                  className={`${inputCls} mt-1 h-auto py-3`}
                />
              </label>
              <button type="submit" className={btnCls}>
                Сохранить с аудитом
              </button>
            </form>
          </Card>
        </aside>
      </div>
    </div>
  );
}
