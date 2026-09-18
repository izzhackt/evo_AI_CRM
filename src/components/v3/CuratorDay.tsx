import Link from "next/link";

import { Badge, Card, EmptyState } from "@/components/ui";
import { MetricRow, type Metric } from "@/components/v3/MetricCard";
import type { PlatformStudentCaseQueueRow } from "@/lib/platform-admissions";
import type { AdmissionsSummary } from "@/lib/platform-admissions-playbook-contract";
import { allDayDate, studentOperationalStage } from "@/lib/v3/wording";

/**
 * «Мой день» — рабочий обзор куратора без доступа к отчёту продаж.
 *
 * Числа берутся из двух уже читаемых источников: `admissions_direction_summary_v1`
 * (сводка по направлениям, отфильтрованная по куратору) и `staff_student_case_page`
 * (собственные активные дела куратора). Каждый блок может не загрузиться сам по
 * себе — второй остаётся читаемым, ничего не изобретаем взамен пропавшего числа.
 */

function summaryMetrics(summary: AdmissionsSummary): Metric[] {
  const total = (key: "active" | "overdue" | "awaiting_ack" | "needs_curator") =>
    summary.stock.reduce((sum, row) => sum + row[key], 0);
  return [
    { label: "В работе", value: total("active"), insteadOfDelta: null },
    { label: "Есть просрочки", value: total("overdue"), insteadOfDelta: null },
    // Unified workflow S4 (plan §12): «Ждём партнёра» is retired along with
    // submission/decision/visa/arrival tracking; «Нужно назначить куратора»
    // (S3's needs_curator) takes its place.
    { label: "Нужно назначить куратора", value: total("needs_curator"), insteadOfDelta: null },
    // Plan §7's own wording for the curator-facing state (matches admissions-view.ts's ATTENTION_LABELS.awaiting_ack).
    { label: "Ожидает принятия", value: total("awaiting_ack"), insteadOfDelta: null },
  ];
}

function CaseRow({ item }: { item: PlatformStudentCaseQueueRow }) {
  const overdue = item.overdueTaskCount > 0 || item.overdueObligationCount > 0;
  const rejected = item.rejectedDocumentCount > 0;
  const due = item.nextActionDueOn ? allDayDate(item.nextActionDueOn) : null;
  return (
    <li>
      <Link
        href={`/v3/profile?case=${item.studentCaseId}&tab=route`}
        className="flex min-h-11 flex-col gap-1.5 px-1 py-3 hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
      >
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-fg">{item.studentDisplayName}</p>
          <p className="mt-0.5 break-words text-sm text-fg-2">
            {studentOperationalStage(item.operationalStage) ?? item.operationalStage}
            {item.nextAction ? ` · ${item.nextAction}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
          {overdue ? <Badge value="overdue" label="Просрочено" /> : null}
          {rejected ? <Badge value="rejected" label="Отклонённые документы" /> : null}
          {due ? <span className="text-sm text-fg-2">{due}</span> : null}
        </div>
      </Link>
    </li>
  );
}

export function CuratorDay({
  cases,
  casesUnavailable,
  hasMore,
  summary,
  summaryUnavailable,
}: Readonly<{
  cases: readonly PlatformStudentCaseQueueRow[];
  casesUnavailable: boolean;
  hasMore: boolean;
  summary: AdmissionsSummary | null;
  summaryUnavailable: boolean;
}>) {
  // Просроченные и заблокированные дела нужны раньше тех, что пока идут по плану.
  const sorted = [...cases].sort((a, b) => {
    const aUrgent = a.overdueTaskCount > 0 || a.overdueObligationCount > 0 || a.rejectedDocumentCount > 0;
    const bUrgent = b.overdueTaskCount > 0 || b.overdueObligationCount > 0 || b.rejectedDocumentCount > 0;
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    if (a.nextActionDueOn && b.nextActionDueOn) return a.nextActionDueOn < b.nextActionDueOn ? -1 : 1;
    if (a.nextActionDueOn) return -1;
    if (b.nextActionDueOn) return 1;
    return 0;
  });

  return (
    <div className="space-y-5">
      {summaryUnavailable ? (
        <p role="alert" className="text-sm text-danger">
          Не удалось загрузить сводку по направлениям. Обновите страницу.
        </p>
      ) : summary ? (
        <MetricRow metrics={summaryMetrics(summary)} />
      ) : null}

      <Card
        title="Мои студенты"
        aside={hasMore ? <span className="text-xs text-fg-3">показаны первые {cases.length}</span> : null}
      >
        {casesUnavailable ? (
          <EmptyState text="Не удалось загрузить список дел. Обновите страницу." />
        ) : sorted.length === 0 ? (
          <EmptyState text="Дел, где вы куратор, пока нет." />
        ) : (
          <ul className="divide-y divide-border px-2">
            {sorted.map((item) => (
              <CaseRow key={item.studentCaseId} item={item} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
