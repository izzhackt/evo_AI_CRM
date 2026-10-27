"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo } from "react";

import { DataTable, DetailSheet, EmptyState, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { QueueList } from "../list-next/QueueList";
import { useDismissedSheet } from "../list-next/useDismissedSheet";
import { sheetEscape } from "../panel/sheet-escape";
import { CoverageDueTime } from "../profile/CoverageDueTime";
import { CuratorCoverageFacts, CuratorCoveragePanel, curatorCoverageSubject } from "../profile/CuratorCoveragePanel";
import { COVERAGE_VIEW_HREF, coverageDue, coverageHref, coverageWorkload, type StudentsCoverage } from "../profile/students-coverage-view";

type Curator = NonNullable<ReturnType<typeof coverageWorkload>>[number];

/**
 * Выбранный куратор для ячеек: колонки — одни и те же функции при любом выборе. Новая функция ячейки пересоздала бы все ячейки
 * таблицы, и ссылка, с которой открыли панель, исчезла бы: Esc возвращал бы фокус на страницу, а не на неё.
 */
const SelectedCurator = createContext<string | null>(null);

function NameCell({ curator }: Readonly<{ curator: Curator }>) {
  const selectedId = useContext(SelectedCurator);
  return (
    <div data-queue-row={curator.id} className="relative z-0 min-w-0 py-0.5">
      <Link href={coverageHref(curator.id)} scroll={false} data-queue-open="" aria-current={curator.id === selectedId ? "true" : undefined}
        className="block truncate t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline">{curator.name}</Link>
      {!curator.active ? <span className="block t-meta text-fg-2">недоступен для нового назначения</span> : null}
    </div>
  );
}

function columns(today: string): DataTableColumn<Curator>[] {
  return [
    { id: "name", header: "Куратор", accessorFn: (curator) => curator.name, sortFn: "text", enableHiding: false, meta: { label: "Куратор", mobile: "title", opensRow: true },
      cell: ({ row }) => <NameCell curator={row.original} /> },
    { id: "cases", header: "Активных дел", accessorFn: (curator) => curator.active_case_count, sortFn: "basic", meta: { label: "Активных дел" }, cell: ({ row }) => <span className="tabular-nums text-fg">{row.original.active_case_count}</span> },
    { id: "tasks", header: "Открытых задач", accessorFn: (curator) => curator.open_task_count, sortFn: "basic", meta: { label: "Открытых задач" }, cell: ({ row }) => <span className="tabular-nums text-fg">{row.original.open_task_count}</span> },
    { id: "due", header: "Ближайший срок", accessorFn: (curator) => curator.nearest_due?.due_on ?? curator.nearest_due?.due_at ?? "9999", sortFn: "text", meta: { label: "Ближайший срок" },
      cell: ({ row }) => coverageDue(row.original.nearest_due, today)
        ? <CoverageDueTime value={row.original.nearest_due} today={today} />
        // «Без срока» в каждой строке — шум: пустой срок — тире, слова остаются читалке.
        : <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">Без срока</span></> },
  ];
}

/**
 * «Нагрузка кураторов» в «Новом виде»: таблица из того же чтения (`read_curator_coverage_workspace`), выбор куратора
 * открывает прежние `CuratorCoveragePanel` и форму замещения в панели. Нет чтения — нет чисел, и это сказано словами.
 */
export function CuratorsNext({ coverage, today, requestId }: Readonly<{ coverage: StudentsCoverage; today: string; requestId: string }>) {
  const router = useRouter();
  const workload = coverageWorkload(coverage);
  const selectedId = coverage.kind === "hidden" || coverage.kind === "invalid" ? null : coverage.curatorId;
  const sheet = useDismissedSheet(selectedId);
  const defs = useMemo(() => columns(today), [today]);
  if (coverage.kind === "hidden") return <p role="status" className="t-body-compact text-fg-2">Нагрузка кураторов для вашей учётной записи недоступна.</p>;
  if (coverage.kind === "invalid") return <CuratorCoveragePanel coverage={coverage} fallbackName={null} requestId={requestId} today={today} />;
  if (!workload) {
    return (
      <div role="alert" className="rounded-card border border-border bg-surface">
        <EmptyState tone="danger" title="Нагрузка сейчас недоступна. Это не означает, что дел или задач нет."
          action={<Button variant="outline" asChild><Link href={selectedId ? coverageHref(selectedId) : COVERAGE_VIEW_HREF}>Повторить</Link></Button>} />
      </div>
    );
  }
  const selectedName = workload.find((curator) => curator.id === selectedId)?.name ?? null;
  const subject = curatorCoverageSubject(coverage, selectedName);
  return (
    <SelectedCurator.Provider value={selectedId}>
      <div data-testid="v3-curator-workload">
        <QueueList keys={!selectedId || sheet.closed}>
          <DataTable
            label="Нагрузка кураторов"
            data={workload}
            columns={defs}
            getRowId={(curator) => curator.id}
            onRowClick={(curator) => { sheet.reset(); router.push(coverageHref(curator.id), { scroll: false }); }}
            getRowLabel={(curator) => curator.name}
            searchable={false}
            paginate={false}
            columnMenu={false}
          />
        </QueueList>
        {selectedId ? (
          <DetailSheet open={!sheet.closed} onOpenChange={(next) => { if (!next) { sheet.dismiss(); router.push(COVERAGE_VIEW_HREF, { scroll: false }); } }} onEscapeKeyDown={sheetEscape} title={subject.name}>
            {subject.selected ? <div className="mb-4"><CuratorCoverageFacts selected={subject.selected} today={today} /></div> : null}
            <CuratorCoveragePanel key={selectedId} coverage={coverage} fallbackName={selectedName} requestId={requestId} today={today} />
          </DetailSheet>
        ) : null}
      </div>
    </SelectedCurator.Provider>
  );
}
