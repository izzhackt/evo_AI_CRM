import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { SalesRegisterWorkspace, SalesRegisterIntakeOptions } from "@/lib/platform-sales-register-contract";
import { readSalesRegisterWorkspace, readSalesRegisterIntakeOptions, readSalesRegisterWriteAccess, readSalesRegisterDirections } from "@/lib/v3/sales-register-source";
import { readMonthlyPaymentSummary } from "@/lib/v3/finance-entry-source";
import { financeMoney, type MonthlyPaymentSummaryRead } from "@/lib/platform-finance-entry-contract";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { SalesReportNavigation } from "./SalesReportNavigation";
import { SalesRegisterForm, SalesRegisterImport, SalesTargetForm } from "./SalesRegisterForms";
import { SalesRecordPreview } from "./SalesRecordPreview";
import { parseSalesRegisterSearchQuery } from "@/lib/sales-register-search";
import { parseSalesRegisterDirection, salesDirectionControl } from "@/lib/sales-register-directions";

export type SalesReportQuery = Readonly<{
  year?: string; month?: string; offset?: string; record?: string; new?: string; archived?: string;
  manager?: string; direction?: string; review?: string; saved?: string; edit?: string; q?: string;
}>;
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const money = (minor: number | null, currency: string | null) => minor === null || !currency ? "Не уточнено" : `${number.format(minor / 100)} ${currency}`;
const dateLabel = (date: string | null) => date ? date.split("-").reverse().join(".") : "Дата не указана";

export async function SalesRegisterView({ actor, query }: { actor: ActivePlatformActor; query: SalesReportQuery }) {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = query.year === undefined ? Number(now.find(p => p.type === "year")!.value) : Number(query.year);
  const month = query.month === undefined ? Number(now.find(p => p.type === "month")!.value) : query.month === "all" ? undefined : Number(query.month);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  const searchQuery = parseSalesRegisterSearchQuery(query.q);
  const valid = searchQuery !== null && Number.isInteger(year) && year >= 1900 && year <= 2100
    && (query.year === undefined || /^\d{4}$/.test(query.year))
    && (month === undefined || (Number.isInteger(month) && month >= 1 && month <= 12))
    && Number.isInteger(offset) && offset >= 0 && offset <= 1_000_000
    && (query.manager === undefined || (typeof query.manager === "string" && query.manager.length <= 300))
    && parseSalesRegisterDirection(query.direction) !== null
    && (query.review === undefined || ["", "true", "false"].includes(query.review));
  const writeAccess = await readSalesRegisterWriteAccess(actor);
  const canManage = writeAccess === "allowed";
  const viewingRecord = Boolean(query.record);
  const editing = (query.new === "true" && !viewingRecord) || (viewingRecord && query.edit === "true");
  const directionsPromise = !viewingRecord && !(editing && canManage)
    ? readSalesRegisterDirections(actor).catch(() => null) : Promise.resolve(null);
  const canTarget = !isStaffPreview(actor) && staffHasPermission(actor, "sales.register.target.manage");
  const canImport = !isStaffPreview(actor) && staffHasPermission(actor, "sales.register.import");
  const checkFinanceAccess = staffHasPermission(actor, "finance.read.full") && !isStaffPreview(actor);
  let workspace: SalesRegisterWorkspace | null = null;
  let intakeOptions: SalesRegisterIntakeOptions | null = null;
  let cash: MonthlyPaymentSummaryRead | Readonly<{ status: "unavailable" }> | null = null;
  if (valid) {
    [workspace, cash, intakeOptions] = await Promise.all([
      readSalesRegisterWorkspace(actor, { year, month, offset, recordId: query.record ?? query.saved, archived: query.archived === "true",
        manager: query.manager, direction: query.direction, needsReview: query.review ? query.review === "true" : null,
        query: searchQuery }).catch(() => null),
      checkFinanceAccess && month ? readMonthlyPaymentSummary(actor, year, month)
        .catch(() => ({ status: "unavailable" as const })) : Promise.resolve(null),
      query.new === "true" && !query.record && canManage ? readSalesRegisterIntakeOptions(actor).catch(() => null) : Promise.resolve(null),
    ]);
  }
  const directionControl = salesDirectionControl(await directionsPromise, query.direction);
  const directionHelp = directionControl.kind === "input"
    ? directionControl.reason === "invalid"
      ? "Введите направление до 500 символов без переносов строк и служебных символов."
      : "Не удалось загрузить список. Введите направление как в записи или обновите страницу."
    : directionControl.empty ? "В доступных записях нет заполненных направлений." : null;
  const params = new URLSearchParams({ view: "sales", year: String(year), month: month ? String(month) : "all" });
  const clearFiltersHref = `/v3/main?${params.toString()}`;
  const hasFilters = Boolean(searchQuery || query.manager || query.direction || query.review || query.archived === "true");
  if (searchQuery) params.set("q", searchQuery);
  if (query.archived === "true") params.set("archived", "true");
  if (query.manager) params.set("manager", query.manager);
  if (query.direction) params.set("direction", query.direction);
  if (query.review) params.set("review", query.review);
  if (valid && offset > 0) params.set("offset", String(offset));
  const href = (extra: Record<string, string> = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(extra)) next.set(key, value);
    return `/v3/main?${next.toString()}`;
  };
  const reportMonth = `${year}-${String(month ?? Number(now.find(p => p.type === "month")!.value)).padStart(2, "0")}-01`;
  const saved = !editing && !viewingRecord && query.saved && workspace?.selected?.id === query.saved ? workspace.selected : null;
  const target = workspace?.targets.find(t => t.reportMonth === reportMonth && t.managerLabel === null) ?? null;
  const backHref = viewingRecord && workspace?.selected ? `${href()}#sale-${workspace.selected.id}` : href();

  return <main className="mx-auto min-w-0 w-full max-w-[1240px] px-4 py-8 sm:px-6">
    <SalesReportNavigation sales />
    {(!editing || !canManage) && !viewingRecord ? <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Отчёт продаж</h1>
      </div>
      {!editing && workspace && canManage ? <Link href={href({ new: "true" })} className={`${btnCls} min-h-11`}>Добавить продажу</Link> : null}
    </header> : null}

    {writeAccess === "unavailable" ? <p role="alert" className="mt-4 text-sm text-fg-2">Не удалось проверить права на запись продажи. Обновите страницу перед добавлением или изменением.</p> : null}
    {editing && writeAccess === "denied" ? <p role="status" className="mt-4 text-sm text-fg-2">Добавление и исправление продаж доступны Sales Manager.</p> : null}
    {saved ? <section id="saved-sale" aria-labelledby="saved-sale-title" className="mt-6 scroll-mt-4 rounded-card border border-accent bg-surface-2 p-4">
      <h2 id="saved-sale-title" className="text-base font-semibold text-fg">Продажа добавлена</h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0"><p className="break-words font-medium text-fg">{saved.applicantName}</p>
          <p className="mt-1 text-sm text-fg-2">{dateLabel(saved.signingDate)} · {money(saved.serviceCostMinor, saved.serviceCostCurrency)}</p></div>
        {saved.leadId ? <Link href={`/v3/profile?id=${encodeURIComponent(saved.leadId)}`} className={`${btnCls} min-h-11`}>Открыть дело</Link> : null}
      </div>
    </section> : null}
    {editing && canManage ? <div className="mt-6 max-w-[860px]">
      <SalesRegisterForm key={query.record ?? "new"} record={workspace?.selected ?? null}
        recordId={query.record ?? null} reportMonth={reportMonth} ownerOptions={workspace?.ownerOptions ?? []}
        canChooseOwner={canManage} requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={backHref} readUnavailable={!workspace}
        ownMembershipId={actor.membershipId} ownLabel={actor.displayName} intakeOptions={intakeOptions} />
    </div> : viewingRecord ? <SalesRecordPreview record={workspace?.selected ?? null} backHref={backHref}
      editHref={canManage && workspace?.selected ? href({ record: workspace.selected.id, edit: "true" }) : null} /> : <>
      <form key={params.toString()} method="get" aria-label="Фильтры отчёта продаж" className="mt-6 grid grid-cols-2 items-start gap-3 rounded-card border border-border bg-surface p-4 @2xl:flex @2xl:flex-wrap">
        <input type="hidden" name="view" value="sales" />
        <label className="min-w-0 @2xl:w-28"><span className={labelCls}>Год</span><input name="year" type="number" min="1900" max="2100" required defaultValue={valid ? year : ""} className={`${inputCls} min-h-11`} /></label>
        <label className="min-w-0 @2xl:w-44"><span className={labelCls}>Месяц</span><select name="month" defaultValue={month ?? "all"} className={`${inputCls} min-h-11`}>
          <option value="all">Весь год</option>{MONTHS.map((title, i) => <option key={title} value={i + 1}>{title}</option>)}
        </select></label>
        <label className="col-span-2 min-w-0 @2xl:min-w-60 @2xl:flex-1"><span className={labelCls}>Имя, телефон или договор</span><input name="q" type="search" defaultValue={searchQuery ?? (typeof query.q === "string" ? query.q : "")} maxLength={200} className={`${inputCls} min-h-11`} /></label>
        <label className="min-w-0 @2xl:w-40"><span className={labelCls}>Записи</span><select name="archived" defaultValue={query.archived === "true" ? "true" : "false"} className={`${inputCls} min-h-11`}>
          <option value="false">Рабочие</option><option value="true">Архив</option>
        </select></label>
        <label className="min-w-0 @2xl:w-44"><span className={labelCls}>Менеджер</span><select name="manager" defaultValue={query.manager ?? ""} className={`${inputCls} min-h-11`}><option value="">Все</option>{query.manager && !workspace?.managerLabels.includes(query.manager) ? <option value={query.manager}>{query.manager}</option> : null}{workspace?.managerLabels.map(label => <option key={label} value={label}>{label}</option>)}</select></label>
        <label className="min-w-0 @2xl:w-44"><span id="sales-direction-label" className={labelCls}>Направление</span>
          {directionControl.kind === "select" ? <select name="direction" defaultValue={directionControl.value}
            aria-labelledby="sales-direction-label" aria-describedby={directionHelp ? "sales-direction-help" : undefined} className={`${inputCls} min-h-11`}>
            {directionControl.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : <input name="direction" defaultValue={directionControl.value} maxLength={1000} placeholder="Как в записи"
            aria-labelledby="sales-direction-label" aria-invalid={directionControl.reason === "invalid" ? true : undefined} aria-describedby="sales-direction-help" className={`${inputCls} min-h-11`} />}
          {directionHelp ? <span id="sales-direction-help" className="mt-1 block text-xs leading-relaxed text-fg-2">{directionHelp}</span> : null}
        </label>
        <label className="min-w-0 @2xl:w-44"><span className={labelCls}>Уточнения</span><select name="review" defaultValue={query.review ?? ""} className={`${inputCls} min-h-11`}><option value="">Все</option><option value="true">Нужно уточнить</option><option value="false">Сверенные</option></select></label>
        <button className={`${btnGhostCls} min-h-11 w-full shrink-0 @2xl:mt-5 @2xl:w-auto`} type="submit">Показать</button>
        {valid && hasFilters ? <Link href={clearFiltersHref} className={`${btnGhostCls} min-h-11 w-full shrink-0 @2xl:mt-5 @2xl:w-auto`}>Сбросить фильтры</Link> : null}
      </form>
      {!workspace ? <div role="alert" className="mt-8 space-y-3 border-s-2 border-border ps-4 text-sm text-fg-2">
        <p>{searchQuery === null ? "Введите поисковый запрос до 200 символов без переносов строк." : valid ? "Не удалось загрузить отчёт. Проверьте подключение и повторите загрузку." : "Проверьте год, месяц и номер страницы."}</p>
        <Link href="/v3/main?view=sales" className={`${btnGhostCls} min-h-11`}>Открыть текущий месяц</Link>
      </div> : <>
        <div className="@container/sales-summary mt-5 min-w-0 border-b border-border pb-4">
          <section aria-labelledby="sales-period-totals">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="sales-period-totals" className="text-sm font-semibold text-fg">Найдено по фильтрам</h2>
              <dl className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <dt className={query.archived === "true" ? "text-fg-2" : "sr-only"}>{query.archived === "true" ? "Записей в архиве" : "Записей продаж"}</dt>
                <dd className="font-mono text-base tabular-nums text-fg">{workspace.totalCount}</dd>
              </dl>
            </div>
            {workspace.totals.length > 0 ? <>
              <ul aria-label="Денежные итоги по валютам" className="mt-3 divide-y divide-border">
                {workspace.totals.map(t => <li key={t.currency} className="grid min-w-0 gap-x-4 gap-y-1.5 py-2 @min-[36rem]/sales-summary:grid-cols-[4rem_minmax(0,1fr)]">
                  <h3 className="text-sm font-medium text-fg">{t.currency}</h3>
                  <dl className="grid min-w-0 gap-x-6 gap-y-1 @min-[36rem]/sales-summary:grid-cols-2">
                    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <dt className="text-sm text-fg-2">Стоимость</dt>
                      <dd className="min-w-0 max-w-full font-mono text-sm tabular-nums text-fg [overflow-wrap:anywhere]">{number.format(t.costMinor / 100)}</dd>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <dt className="text-sm text-fg-2">Оплачено по записям</dt>
                      <dd className="min-w-0 max-w-full font-mono text-sm tabular-nums text-fg [overflow-wrap:anywhere]">{number.format(t.paidMinor / 100)}</dd>
                    </div>
                  </dl>
                </li>)}
              </ul>
              <p className="mt-2 text-xs leading-relaxed text-fg-2">Накопленные суммы по записям, не поступления за месяц. Валюты не пересчитываются.</p>
            </> : null}
            {workspace.unresolvedCostCount > 0 || workspace.unresolvedPaidCount > 0 ? <p className="mt-3 border-s border-border ps-3 text-sm leading-relaxed text-fg-2">В денежные итоги не включены неуточнённые значения: стоимость — {workspace.unresolvedCostCount}, оплата — {workspace.unresolvedPaidCount}.</p> : null}
          </section>
          {checkFinanceAccess && month && query.archived !== "true" ? <section aria-labelledby="sales-department-target" className="mt-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="sales-department-target" className="text-sm font-medium text-fg">План отдела</h2>
              <p className="font-mono text-sm tabular-nums text-fg">{target ? target.targetCount : "Не задан"}</p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-2">На выбранный месяц. Фильтры записей не меняют план.</p>
          </section> : null}
        </div>
        {cash && cash.status !== "not_allowed" && month ? <section aria-labelledby="sales-cash-totals" className="border-b border-border py-6">
          <h2 id="sales-cash-totals" className="text-base font-semibold text-fg">Поступления и возвраты за месяц</h2>
          <p className="mt-2 text-xs leading-relaxed text-fg-2">Подтверждённые финансовые события всей организации по дате операции, время Бишкека. Фильтры строк продаж на этот блок не влияют. Расходы третьих сторон не являются выручкой EVO.</p>
          {cash.status === "unavailable" ? <p role="alert" className="mt-4 text-sm text-fg-2">Не удалось загрузить финансовую сводку. Обновите страницу, чтобы повторить.</p> : cash.totals.length === 0 ? <p className="mt-4 text-sm text-fg-2">В этом месяце подтверждённых финансовых событий нет.</p> : <div className="mt-4 grid gap-4 md:grid-cols-2">{cash.totals.map(total => <dl key={total.currency} className="space-y-2 rounded-card border border-border p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-3"><dt>Получено · {total.currency}</dt><dd className="font-mono">{financeMoney(total.paymentsMinor, total.currency)}</dd></div>
            <div className="flex flex-wrap justify-between gap-3"><dt>Возвращено</dt><dd className="font-mono">{financeMoney(total.refundsMinor, total.currency)}</dd></div>
            <div className="flex flex-wrap justify-between gap-3 font-semibold"><dt>Итого</dt><dd className="font-mono">{financeMoney(total.netMinor, total.currency)}</dd></div>
          </dl>)}</div>}
        </section> : null}

        {workspace.rows.length === 0 ? <div className="space-y-2 py-12 text-center">
          <p className="text-base font-medium text-fg">{offset > 0 ? "На этой странице записей нет." : hasFilters ? "По выбранным фильтрам записей не найдено." : "В выбранном периоде записей нет."}</p>
          <p className="text-sm text-fg-2">{offset > 0 ? "Вернитесь к началу списка с теми же фильтрами." : hasFilters ? "Измените или сбросьте фильтры. Выбранный период сохранится." : "Выберите другой месяц или весь год в фильтрах выше."}</p>
          {offset > 0 ? <Link href={href({ offset: "0" })} className={`${btnGhostCls} min-h-11`}>К началу списка</Link>
            : hasFilters ? <Link href={clearFiltersHref} className={`${btnGhostCls} min-h-11`}>Сбросить фильтры</Link> : null}
        </div> : <div className="@container/sales-records mt-6">
          <div role="region" aria-label="Записи продаж" tabIndex={0} className="relative max-w-full overflow-x-auto rounded-nav border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <table role="table" className="block w-full text-left text-sm @min-[60rem]/sales-records:table @min-[60rem]/sales-records:min-w-[960px]">
              <caption className="sr-only">Продажи выбранного периода</caption>
              <thead role="rowgroup" className="sr-only border-b border-border bg-surface-2 text-xs text-fg-2 @min-[60rem]/sales-records:not-sr-only @min-[60rem]/sales-records:table-header-group"><tr role="row"><th role="columnheader" scope="col" className="px-4 py-3 font-medium">Студент и программа</th><th role="columnheader" scope="col" className="px-4 py-3 font-medium">Менеджер и дата</th><th role="columnheader" scope="col" className="px-4 py-3 text-right font-medium">Стоимость</th><th role="columnheader" scope="col" className="px-4 py-3 text-right font-medium">Оплачено по записи</th><th role="columnheader" scope="col" className="px-4 py-3 font-medium">Уточнения</th><th role="columnheader" scope="col" className="px-4 py-3"><span className="sr-only">Действие</span></th></tr></thead>
              <tbody role="rowgroup" className="block divide-y divide-border @min-[60rem]/sales-records:table-row-group">{workspace.rows.map(row => <tr role="row" key={row.id} id={`sale-${row.id}`} className={`block scroll-mt-24 align-top @min-[60rem]/sales-records:table-row ${row.id === saved?.id ? "bg-surface-2" : "bg-surface hover:bg-surface-2"}`}>
                <th role="rowheader" scope="row" className="block min-w-0 px-4 pt-3 pb-1 font-normal @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:min-w-[240px] @min-[60rem]/sales-records:max-w-[360px] @min-[60rem]/sales-records:py-3"><Link href={href({ record: row.id })} className="inline-flex min-h-11 max-w-full items-center font-semibold text-fg underline-offset-4 hover:underline"><span className="min-w-0 break-words">{row.applicantName || "Имя не указано"}</span></Link><p className="break-words text-sm text-fg-2">{[row.country, row.program].filter(Boolean).join(" · ") || "Программа не указана"}</p></th>
                <td role="cell" className="block min-w-0 px-4 pt-2 pb-3 @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:min-w-[180px] @min-[60rem]/sales-records:max-w-[260px] @min-[60rem]/sales-records:py-5"><span aria-hidden="true" className="mb-1 block text-xs text-fg-2 @min-[60rem]/sales-records:hidden">Менеджер и дата</span><p className="break-words text-fg">{row.managerLabel || "Менеджер не указан"}</p><p className="mt-1 text-xs text-fg-2">{dateLabel(row.signingDate)}</p>{month === undefined ? <p className="mt-1 text-xs text-fg-2">Месяц отчёта: {MONTHS[Number(row.reportMonth.slice(5, 7)) - 1]} {row.reportMonth.slice(0, 4)}</p> : null}</td>
                <td role="cell" className="block px-4 py-2 @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:py-5 @min-[60rem]/sales-records:text-right @min-[60rem]/sales-records:whitespace-nowrap"><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 @min-[60rem]/sales-records:block"><span aria-hidden="true" className="text-fg-2 @min-[60rem]/sales-records:hidden">Стоимость</span><span className="ms-auto min-w-0 max-w-full break-words font-mono tabular-nums">{money(row.serviceCostMinor, row.serviceCostCurrency)}</span></div></td>
                <td role="cell" className="block px-4 py-2 @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:py-5 @min-[60rem]/sales-records:text-right @min-[60rem]/sales-records:whitespace-nowrap"><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 @min-[60rem]/sales-records:block"><span aria-hidden="true" className="text-fg-2 @min-[60rem]/sales-records:hidden">Оплачено по записи</span><span className="ms-auto min-w-0 max-w-full break-words font-mono tabular-nums">{money(row.paidMinor, row.paidCurrency)}</span></div></td>
                <td role="cell" className="block px-4 pt-1 text-xs text-fg-2 @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:min-w-[140px] @min-[60rem]/sales-records:py-5">{row.needsReview ? "Нужно уточнить" : row.archived ? "В архиве" : ""}</td>
                <td role="cell" className="block px-4 pt-2 pb-4 @min-[60rem]/sales-records:table-cell @min-[60rem]/sales-records:py-3"><Link href={href({ record: row.id })} className={`${btnGhostCls} min-h-11 w-full justify-center whitespace-nowrap @min-[60rem]/sales-records:w-auto`}>Открыть<span className="sr-only">: {row.applicantName || "Имя не указано"}</span></Link></td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>}
        <nav aria-label="Страницы отчёта" className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {offset > 0 ? <Link href={href({ offset: String(Math.max(0, offset - 50)) })} className={`${btnGhostCls} min-h-11`}>Назад</Link> : <span />}
          <span className="text-xs text-fg-3">{workspace.rows.length ? `${offset + 1}–${offset + workspace.rows.length} из ${workspace.totalCount}` : ""}</span>
          {workspace.hasMore ? <Link href={href({ offset: String(offset + 50) })} className={`${btnGhostCls} min-h-11`}>Далее</Link> : <span />}
        </nav>
      </>}
      {canTarget || canImport ? <div className="mt-8 space-y-5 border-t border-border pt-5">
        {canTarget && month && query.archived !== "true" ? <details><summary className="cursor-pointer py-3 text-sm font-medium">Изменить план месяца</summary><SalesTargetForm key={reportMonth} reportMonth={reportMonth} target={target} requestId={randomUUID()} readUnavailable={!workspace} /></details> : null}
        {canImport ? <details><summary className="cursor-pointer py-3 text-sm font-medium">Начальный перенос данных</summary><SalesRegisterImport requestId={randomUUID()} /></details> : null}
      </div> : null}
    </>}
  </main>;
}
