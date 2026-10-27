"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { DataTable, DetailSheet, EmptyState, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { useDismissedSheet } from "../list-next/useDismissedSheet";
import { CoverageDueTime } from "../profile/CoverageDueTime";
import { CuratorCoverageFacts, CuratorCoveragePanel, curatorCoverageSubject } from "../profile/CuratorCoveragePanel";
import { COVERAGE_VIEW_HREF, coverageDue, coverageHref, coverageWorkload, type StudentsCoverage } from "../profile/students-coverage-view";

type Curator = NonNullable<ReturnType<typeof coverageWorkload>>[number];

function columns(today: string, selectedId: string | null): DataTableColumn<Curator>[] {
  return [
    { id: "name", header: "Куратор", accessorFn: (curator) => curator.name, sortFn: "text", enableHiding: false, meta: { label: "Куратор", mobile: "title", opensRow: true },
      cell: ({ row }) => (
        <div data-queue-row={row.original.id} className="relative z-0 min-w-0 py-0.5">
          <Link href={coverageHref(row.original.id)} scroll={false} data-queue-open="" aria-current={row.original.id === selectedId ? "true" : undefined}
            className="block truncate t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline">{row.original.name}</Link>
          {!row.original.active ? <span className="block t-meta text-fg-2">недоступен для нового назначения</span> : null}
        </div>
      ) },
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
  const defs = useMemo(() => columns(today, selectedId), [today, selectedId]);
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
    <div data-testid="v3-curator-workload">
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
      {selectedId ? (
        <DetailSheet open={!sheet.closed} onOpenChange={(next) => { if (!next) { sheet.dismiss(); router.push(COVERAGE_VIEW_HREF, { scroll: false }); } }} title={subject.name}>
          {subject.selected ? <div className="mb-4"><CuratorCoverageFacts selected={subject.selected} today={today} /></div> : null}
          <CuratorCoveragePanel key={selectedId} coverage={coverage} fallbackName={selectedName} requestId={requestId} today={today} />
        </DetailSheet>
      ) : null}
    </div>
  );
}
