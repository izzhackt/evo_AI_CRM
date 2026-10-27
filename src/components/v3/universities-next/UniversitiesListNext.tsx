"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SettingsIcon } from "lucide-react";

import { DataTable, EmptyState, PageShell, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { LinkFilters } from "../list-next/LinkFilters";
import { ListSearch } from "../list-next/ListSearch";
import { DeadlineCell, UniversityCell } from "./UniversityListCells";
import type { UniversityListProps, UniversityListRow } from "./university-list-types";

const COLUMNS: DataTableColumn<UniversityListRow>[] = [
  { id: "name", header: "Университет", accessorFn: (row) => row.name, sortFn: "text", enableHiding: false, meta: { label: "Университет", mobile: "title", opensRow: true }, cell: ({ row }) => <UniversityCell row={row.original} /> },
  { id: "programs", header: "Программы", accessorFn: (row) => row.programs, sortFn: "basic", meta: { label: "Программы" }, cell: ({ row }) => <span className="tabular-nums t-body-compact text-fg">{row.original.programs}</span> },
  { id: "deadline", header: "Ближайший срок", accessorFn: (row) => row.deadline?.dateTime ?? "9999", sortFn: "text", meta: { label: "Ближайший срок" }, cell: ({ row }) => <DeadlineCell row={row.original} /> },
];

/**
 * Каталог «Университетов» в «Новом виде»: поиск по каталогу с паузой набора, «Страна» и «Уровень» ссылками, таблица
 * с ближайшим сроком подачи и страницы сервера. Чтение, порядок (по сроку, при большом каталоге — по названию) и права те же;
 * управление каталогом — тихие кнопки в шапке только тому, у кого есть право.
 */
export function UniversitiesListNext({ rows, page, query, searchHidden, filters, canManage, empty }: UniversityListProps) {
  const router = useRouter();
  return (
    <PageShell
      title="Университеты"
      count={page.total}
      testId="v3-universities-next"
      help={page.order === "name" ? "Каталог длиннее предела полного чтения: порядок — по названию, страницы ведёт сервер." : "Сначала ближайший подтверждённый срок подачи, затем по названию. Поиск и фильтры отбирает сервер по всему каталогу."}
      actions={canManage ? <>
        <Button variant="ghost" asChild><Link href="/v3/universities/cities">Города</Link></Button>
        <Button variant="ghost" asChild><Link href="/v3/universities/rates">Курсы валют</Link></Button>
        <Button variant="outline" asChild><Link href="/v3/universities/manage"><SettingsIcon aria-hidden="true" />Управлять каталогом</Link></Button>
      </> : undefined}
    >
      <div className="grid min-w-0 gap-3">
        <DataTable
          label="Университеты"
          data={rows}
          columns={COLUMNS}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/v3/universities/${row.id}`)}
          getRowLabel={(row) => row.name}
          searchable={false}
          paginate={false}
          columnMenu={false}
          toolbar={<>
            <ListSearch action="/v3/universities" value={query} placeholder="Найти университет" label="Поиск университетов" hidden={searchHidden} liveMs={400} />
            <LinkFilters bar={filters} />
          </>}
          empty={<EmptyState title={empty.title} description={empty.description}
            action={empty.backHref ? <Button variant="outline" asChild><Link href={empty.backHref}>К предыдущей странице</Link></Button> : undefined} />}
        />
        {page.previousHref || page.nextHref ? (
          <nav aria-label="Страницы каталога" className="flex flex-wrap items-center justify-between gap-3">
            <p className="t-meta text-fg-2">
              {page.first ? <><span className="tabular-nums">{page.first}–{page.last}</span>{page.total !== null ? <> из <span className="tabular-nums">{page.total}</span></> : null}</> : "На этой странице университетов нет"}
            </p>
            <div className="flex gap-2">
              {page.previousHref ? <Button variant="outline" asChild><Link href={page.previousHref} scroll={false}>Назад</Link></Button> : null}
              {page.nextHref ? <Button variant="outline" asChild><Link href={page.nextHref} scroll={false}>Дальше</Link></Button> : null}
            </div>
          </nav>
        ) : null}
      </div>
    </PageShell>
  );
}
