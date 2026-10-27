import Link from "next/link";

import { EmptyState, PageShell, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { SalesCashCard } from "./SalesCashCard";
import { SalesHeadlineTiles } from "./SalesHeadlineTiles";
import { SalesMoneyCard } from "./SalesMoneyCard";
import { SalesPlanCard } from "./SalesPlanCard";
import { SalesRecordsTable, type SalesSheetContent } from "./SalesRecordsTable";
import type { SalesCashData, SalesHeadlineData, SalesMoneyData, SalesRowData, SalesSavedData } from "./sales-next-types";

type Link_ = Readonly<{ href: string; label: string }>;

export type SalesReportNextProps = Readonly<{
  period: React.ReactNode;
  addHref: string | null;
  alerts: readonly Readonly<{ role: "alert" | "status"; text: string }>[];
  headline: SalesHeadlineData | null;
  saved: SalesSavedData | null;
  failure: Readonly<{ text: string; link: Link_ }> | null;
  money: SalesMoneyData | null;
  archive: string | null;
  toolbar: React.ReactNode;
  variantNote: boolean;
  slice: Readonly<{ text: string; link: Link_ }> | null;
  table: Readonly<{
    rows: readonly SalesRowData[]; openKey: string | null; sheet: SalesSheetContent | null; listHref: string; showRest: boolean; showAction: boolean; count: number;
    empty: Readonly<{ title: string; description: string; action: Link_ | null }>;
  }> | null;
  pagination: Readonly<{ prevHref: string | null; nextHref: string | null; range: string }> | null;
  cash: SalesCashData | null;
  plan: Readonly<{ target: number | null; form: React.ReactNode | null; importHref: string | null; unavailable: boolean }> | null;
  dynamics: React.ReactNode;
}>;

/**
 * «Отчёт продаж» нового вида целиком: рамка страницы (период и «Добавить продажу» — одна группа действий), плитки «Продажи» и «План»,
 * суммы по валютам, таблица записей с панелью, поступления за месяц, «Динамика по дням» и «Звонки» (прежние серверные части) и план месяца.
 * Показывается через `SalesReportNextLazy`; чтения, права, адреса и команды — те же, что у прежнего вида.
 */
export function SalesReportNextPage({ period, addHref, alerts, headline, saved, failure, money, archive, toolbar, variantNote, slice, table, pagination, cash, plan, dynamics }: SalesReportNextProps) {
  return (
    <PageShell
      title="Отчёт продаж"
      testId="v3-sales-report"
      actions={<>{period}{addHref ? <Button asChild><Link href={addHref}>Добавить продажу</Link></Button> : null}</>}
    >
      {alerts.map((alert) => <p key={alert.text} role={alert.role} className="t-body-compact text-fg-2">{alert.text}</p>)}
      {headline ? <SalesHeadlineTiles data={headline} /> : null}
      {saved ? (
        <WidgetCard title="Продажа добавлена" id="saved-sale" actions={saved.openHref ? <Button variant="outline" asChild><Link href={saved.openHref}>Открыть дело</Link></Button> : undefined}>
          {saved.caseCreated ? <p className="t-body-compact text-fg-2">Дело студента создано и передано куратору.</p> : null}
          <p className="t-body-compact text-fg"><span className="break-words font-medium">{saved.name}</span><span className="text-fg-2"> · {saved.facts}</span></p>
        </WidgetCard>
      ) : null}
      {failure ? (
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState tone="danger" title={failure.text} action={<Button variant="outline" asChild><Link href={failure.link.href}>{failure.link.label}</Link></Button>} />
        </div>
      ) : null}
      <SalesMoneyCard data={money} archive={archive} />
      {variantNote ? <p className="t-meta text-fg-2" data-testid="sales-variant-note">Фильтр направления точный: показаны записи с выбранным написанием. Другие написания — в том же меню; сведение к списку направлений — отдельный шаг.</p> : null}
      {slice ? (
        <p role="status" className="flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2" data-sale-slice={slice.text}>
          <span>{slice.text}</span>
          <Link href={slice.link.href} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-fg">{slice.link.label}</Link>
        </p>
      ) : null}
      {table ? (
        <SalesRecordsTable rows={table.rows} openKey={table.openKey} sheet={table.sheet} listHref={table.listHref} showRest={table.showRest} showAction={table.showAction} count={table.count}
          toolbar={toolbar}
          empty={<EmptyState title={table.empty.title} description={table.empty.description} action={table.empty.action ? <Button variant="outline" asChild><Link href={table.empty.action.href}>{table.empty.action.label}</Link></Button> : undefined} />} />
      ) : null}
      {pagination ? (
        <nav aria-label="Страницы отчёта" className="flex flex-wrap items-center justify-between gap-3">
          {pagination.prevHref ? <Button variant="outline" asChild><Link href={pagination.prevHref}>Назад</Link></Button> : <span />}
          <span className="t-meta text-fg-3">{pagination.range}</span>
          {pagination.nextHref ? <Button variant="outline" asChild><Link href={pagination.nextHref}>Далее</Link></Button> : <span />}
        </nav>
      ) : null}
      {cash ? <SalesCashCard data={cash} /> : null}
      {dynamics ? <div className="min-w-0">{dynamics}</div> : null}
      {plan ? <SalesPlanCard {...plan} /> : null}
    </PageShell>
  );
}

/** Рамка вложенных страниц отчёта («Перенос данных», «Менеджеры в отчёте», отчёт роли без записей): возврат к отчёту и прежнее содержимое. */
export function SalesFrameNextPage({ title, back, help, children }: Readonly<{ title: string; back: Link_ | null; help?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <PageShell
      title={title}
      testId="v3-sales-frame"
      help={help}
      actions={back ? <Button variant="outline" asChild><Link href={back.href}>{back.label}</Link></Button> : undefined}
    >
      {children}
    </PageShell>
  );
}
