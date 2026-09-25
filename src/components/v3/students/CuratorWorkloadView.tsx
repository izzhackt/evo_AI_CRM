import Link from "next/link";

import { CoverageDueTime } from "../profile/CoverageDueTime";
import { CuratorCoveragePanel } from "../profile/CuratorCoveragePanel";
import { COVERAGE_VIEW_HREF, coverageHref, coverageWorkload, type StudentsCoverage } from "../profile/students-coverage-view";
import { QueueDetailPanel } from "../queue/QueueDetailPanel";
import { QueueKeyboard } from "../queue/QueueKeyboard";
import { QUEUE_QUIET_LINK } from "../queue/QueueStates";

const COLUMNS = "@min-[40rem]/curators:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] @min-[40rem]/curators:[grid-template-areas:'name_cases_tasks_due']";
const ROW_GRID = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 [grid-template-areas:'name_name'_'cases_tasks'_'due_due'] ${COLUMNS}`;
const CELL = "min-w-0 px-3 @min-[40rem]/curators:px-2 @min-[40rem]/curators:py-3";
const HEAD = "flex h-9 items-center px-2 text-start t-caption text-fg-2 first:ps-3";

/**
 * «Нагрузка кураторов» (Admin): таблица из чтения
 * `read_curator_coverage_workspace` — те же числа, что у прежней панели
 * замещения. Выбор куратора открывает в правой панели прежние
 * `CuratorCoveragePanel` и `CuratorCoverageForm`: поведение, команда и права
 * не меняются. Нет чтения — нет чисел.
 */
export function CuratorWorkloadView({
  head,
  coverage,
  today,
  requestId,
}: Readonly<{
  head: React.ReactNode;
  coverage: StudentsCoverage;
  /** Сегодня в Бишкеке, YYYY-MM-DD. */
  today: string;
  requestId: string;
}>) {
  const workload = coverageWorkload(coverage);
  const selectedId = coverage.kind === "hidden" || coverage.kind === "invalid" ? null : coverage.curatorId;
  const selectedName = workload?.find((curator) => curator.id === selectedId)?.name ?? null;
  const panel = selectedId ? (
    <QueueDetailPanel closeHref={COVERAGE_VIEW_HREF} backLabel="К нагрузке" headingId="curator-coverage-title">
      <CuratorCoveragePanel coverage={coverage} fallbackName={selectedName} requestId={requestId} today={today} />
    </QueueDetailPanel>
  ) : null;

  // Шапка (вкладки) — во всю ширину над таблицей и панелью, как у очереди дел.
  return (
    <div className="min-w-0 space-y-2">
      {head}
      <div className={panel ? "xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-6" : undefined}>
        <div className="min-w-0 space-y-3" data-testid="v3-curator-workload">
          <QueueKeyboard openKey={selectedId} />
          {coverage.kind === "hidden" ? (
            <p role="status" className="border-b border-border py-8 t-body-compact text-fg-2">Нагрузка кураторов доступна Admin.</p>
          ) : coverage.kind === "invalid" ? (
            <CuratorCoveragePanel coverage={coverage} fallbackName={null} requestId={requestId} today={today} />
          ) : !workload ? (
            <div role="alert" className="flex flex-col items-start gap-2 border-y border-border py-8">
              <p className="t-item text-fg">Нагрузка сейчас недоступна. Это не означает, что дел или задач нет.</p>
              <Link href={selectedId ? coverageHref(selectedId) : COVERAGE_VIEW_HREF} className={QUEUE_QUIET_LINK}>Повторить</Link>
            </div>
          ) : (
            <div className="@container/curators min-w-0" data-queue-list="">
              <table role="table" className="block w-full" data-testid="v3-curator-workload-table">
                <caption className="sr-only">Нагрузка кураторов: {workload.length}</caption>
                <thead role="rowgroup" className="sr-only @min-[40rem]/curators:not-sr-only @min-[40rem]/curators:block">
                  <tr role="row" className={`grid gap-x-3 ${COLUMNS} shadow-[inset_0_-1px_0_var(--border)]`}>
                    {(["Куратор", "Активных дел", "Открытых задач", "Ближайший срок"] as const).map((label) => <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>)}
                  </tr>
                </thead>
                <tbody role="rowgroup" className="block">
                  {workload.map((curator) => {
                    const selected = curator.id === selectedId;
                    return (
                      <tr
                        key={curator.id}
                        role="row"
                        data-queue-row={curator.id}
                        className={`v3-queue-row relative ${ROW_GRID} border-b border-border py-2 t-body-compact @min-[40rem]/curators:py-0 ${selected ? "bg-surface-2" : "hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface"}`}
                      >
                        <th role="rowheader" scope="row" className={`${CELL} [grid-area:name] text-start font-normal @min-[40rem]/curators:ps-3`}>
                          <Link
                            href={coverageHref(curator.id)}
                            scroll={false}
                            data-queue-open=""
                            aria-current={selected ? "true" : undefined}
                            className="block truncate t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline"
                          >
                            {curator.name}
                          </Link>
                          {!curator.active ? <span className="block t-meta text-fg-2">недоступен для нового назначения</span> : null}
                        </th>
                        <td role="cell" className={`${CELL} [grid-area:cases] tabular-nums text-fg`}>
                          <span className="@min-[40rem]/curators:hidden text-fg-2">Активных дел: </span>{curator.active_case_count}
                        </td>
                        <td role="cell" className={`${CELL} [grid-area:tasks] tabular-nums text-fg`}>
                          <span className="@min-[40rem]/curators:hidden text-fg-2">Открытых задач: </span>{curator.open_task_count}
                        </td>
                        <td role="cell" className={`${CELL} [grid-area:due] text-fg`}>
                          <span className="@min-[40rem]/curators:hidden text-fg-2">Ближайший срок: </span><CoverageDueTime value={curator.nearest_due} today={today} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {panel}
      </div>
    </div>
  );
}
