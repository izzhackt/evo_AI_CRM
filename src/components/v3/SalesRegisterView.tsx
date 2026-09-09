import { randomUUID } from "node:crypto";
import Link from "next/link";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { SalesRegisterWorkspace } from "@/lib/platform-sales-register-contract";
import { readSalesRegisterWorkspace } from "@/lib/v3/sales-register-source";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { SalesReportNavigation } from "./SalesReportNavigation";
import { SalesRegisterForm, SalesRegisterImport, SalesTargetForm } from "./SalesRegisterForms";

export type SalesReportQuery = Readonly<{
  year?: string; month?: string; offset?: string; record?: string; new?: string; archived?: string;
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
  const valid = Number.isInteger(year) && year >= 1900 && year <= 2100
    && (query.year === undefined || /^\d{4}$/.test(query.year))
    && (month === undefined || (Number.isInteger(month) && month >= 1 && month <= 12))
    && Number.isInteger(offset) && offset >= 0 && offset <= 1_000_000;
  const isAdmin = actor.authorityRole === "admin";
  let workspace: SalesRegisterWorkspace | null = null;
  if (valid) {
    try { workspace = await readSalesRegisterWorkspace(actor, { year, month, offset, recordId: query.record, archived: query.archived === "true" }); }
    catch { /* A failed real read stays visibly unavailable; no sample rows. */ }
  }
  const params = new URLSearchParams({ view: "sales", year: String(year), month: month ? String(month) : "all" });
  if (query.archived === "true") params.set("archived", "true");
  const href = (extra: Record<string, string> = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(extra)) next.set(key, value);
    return `/v3/main?${next.toString()}`;
  };
  const editing = query.new === "true" || Boolean(query.record);
  const reportMonth = `${year}-${String(month ?? Number(now.find(p => p.type === "month")!.value)).padStart(2, "0")}-01`;
  const target = workspace?.targets.find(t => t.reportMonth === reportMonth && t.managerLabel === null) ?? null;

  return <main className="mx-auto min-w-0 w-full max-w-[1240px] px-4 py-8 sm:px-6">
    <SalesReportNavigation sales />
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Отчёт продаж</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-2">Продажи за выбранный период. Откройте запись, чтобы посмотреть детали или внести изменения.</p>
      </div>
      {!editing && workspace ? <Link href={href({ new: "true" })} className={`${btnCls} min-h-11`}>Добавить продажу</Link> : null}
    </header>

    {editing ? <div className="mt-6 max-w-[860px]">
      <SalesRegisterForm key={query.record ?? "new"} record={workspace?.selected ?? null}
        recordId={query.record ?? null} reportMonth={reportMonth} ownerOptions={workspace?.ownerOptions ?? []}
        isAdmin={isAdmin} requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={href()} readUnavailable={!workspace}
        ownMembershipId={actor.membershipId} ownLabel={actor.displayName} />
    </div> : <>
      <form method="get" aria-label="Фильтры отчёта продаж" className="mt-6 flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4">
        <input type="hidden" name="view" value="sales" />
        <label><span className={labelCls}>Год</span><input name="year" type="number" min="1900" max="2100" required defaultValue={valid ? year : ""} className={`${inputCls} min-h-11 w-28`} /></label>
        <label className="min-w-0 flex-1 sm:flex-none"><span className={labelCls}>Месяц</span><select name="month" defaultValue={month ?? "all"} className={`${inputCls} min-h-11`}>
          <option value="all">Весь год</option>{MONTHS.map((title, i) => <option key={title} value={i + 1}>{title}</option>)}
        </select></label>
        <label className="min-w-0 flex-1 sm:flex-none"><span className={labelCls}>Записи</span><select name="archived" defaultValue={query.archived === "true" ? "true" : "false"} className={`${inputCls} min-h-11`}>
          <option value="false">Рабочие</option><option value="true">Архив</option>
        </select></label>
        <button className={`${btnGhostCls} min-h-11 shrink-0`} type="submit">Показать</button>
      </form>
      {!workspace ? <div role="alert" className="mt-8 space-y-3 border-s-2 border-border ps-4 text-sm text-fg-2">
        <p>{valid ? "Не удалось загрузить отчёт. Проверьте подключение и повторите загрузку." : "Проверьте год, месяц и номер страницы."}</p>
        <Link href="/v3/main?view=sales" className={`${btnGhostCls} min-h-11`}>Открыть текущий месяц</Link>
      </div> : <>
        <section aria-labelledby="sales-period-totals" className="mt-8 border-b border-border pb-6">
          <h2 id="sales-period-totals" className="text-base font-semibold text-fg">Итоги периода</h2>
          <div className="mt-4 grid min-w-0 gap-6 @3xl:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)]">
            <dl className="flex flex-wrap content-start gap-x-10 gap-y-4">
              <div><dt className="text-sm text-fg-2">{query.archived === "true" ? "Записей в архиве" : "Записей продаж"}</dt><dd className="mt-1 font-mono text-3xl tabular-nums text-fg">{workspace.totalCount}</dd></div>
              {isAdmin && month && query.archived !== "true" ? <div><dt className="text-sm text-fg-2">План месяца</dt><dd className="mt-1 font-mono text-3xl tabular-nums text-fg">{target ? target.targetCount : "Не задан"}</dd></div> : null}
            </dl>
            {workspace.totals.length > 0 ? <div className="min-w-0">
              <div role="region" aria-label="Денежные итоги по валютам" tabIndex={0} className="max-w-full overflow-x-auto rounded-nav focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <table className="w-full min-w-[400px] text-sm tabular-nums">
                  <caption className="sr-only">Стоимость и накопленная оплата за выбранный период, отдельно по валютам</caption>
                  <thead className="border-b border-border text-xs text-fg-2"><tr><th scope="col" className="pb-3 pe-4 text-left font-medium">Валюта</th><th scope="col" className="pb-3 px-3 text-right font-medium">Стоимость</th><th scope="col" className="pb-3 ps-3 text-right font-medium">Оплачено по записям</th></tr></thead>
                  <tbody className="divide-y divide-border">{workspace.totals.map(t => <tr key={t.currency}><th scope="row" className="py-3 pe-4 text-left font-medium">{t.currency}</th><td className="py-3 px-3 text-right font-mono">{number.format(t.costMinor / 100)}</td><td className="py-3 ps-3 text-right font-mono">{number.format(t.paidMinor / 100)}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-fg-2">Накопленные суммы по записям, не поступления за месяц. Валюты не пересчитываются.</p>
            </div> : null}
          </div>
          {workspace.unresolvedCostCount > 0 || workspace.unresolvedPaidCount > 0 ? <p className="mt-5 border-s-2 border-border ps-3 text-sm leading-relaxed text-fg-2">В денежные итоги не включены неуточнённые значения: стоимость — {workspace.unresolvedCostCount}, оплата — {workspace.unresolvedPaidCount}.</p> : null}
        </section>

        {workspace.rows.length === 0 ? <div className="space-y-2 py-12 text-center">
          <p className="text-base font-medium text-fg">{offset > 0 ? "На этой странице записей нет." : "В выбранном периоде записей нет."}</p>
          <p className="text-sm text-fg-2">{offset > 0 ? "Вернитесь к началу списка." : "Выберите другой месяц или весь год в фильтрах выше."}</p>
        </div> : <div className="mt-6">
          <p id="sales-table-help" className="mb-3 text-xs text-fg-2">Откройте продажу для просмотра деталей. Таблицу можно прокручивать по горизонтали.</p>
          <div role="region" aria-label="Записи продаж" aria-describedby="sales-table-help" tabIndex={0} className="max-w-full overflow-x-auto rounded-nav border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <table className="w-full min-w-[960px] text-left text-sm">
              <caption className="sr-only">Продажи выбранного периода</caption>
              <thead className="border-b border-border bg-surface-2 text-xs text-fg-2"><tr><th scope="col" className="px-4 py-3 font-medium">Студент и программа</th><th scope="col" className="px-4 py-3 font-medium">Менеджер и дата</th><th scope="col" className="px-4 py-3 text-right font-medium">Стоимость</th><th scope="col" className="px-4 py-3 text-right font-medium">Оплачено по записи</th><th scope="col" className="px-4 py-3 font-medium">Уточнения</th><th scope="col" className="px-4 py-3"><span className="sr-only">Действие</span></th></tr></thead>
              <tbody className="divide-y divide-border">{workspace.rows.map(row => <tr key={row.id} className="align-top bg-surface hover:bg-surface-2">
                <th scope="row" className="min-w-[240px] max-w-[360px] px-4 py-3 font-normal"><Link href={href({ record: row.id })} className="inline-flex min-h-11 items-center break-words font-semibold text-fg underline-offset-4 hover:underline">{row.applicantName || "Имя не указано"}</Link><p className="break-words text-sm text-fg-2">{[row.country, row.program].filter(Boolean).join(" · ") || "Программа не указана"}</p></th>
                <td className="min-w-[180px] max-w-[260px] px-4 py-5"><p className="break-words text-fg">{row.managerLabel || "Менеджер не указан"}</p><p className="mt-1 text-xs text-fg-2">{dateLabel(row.signingDate)}</p></td>
                <td className="whitespace-nowrap px-4 py-5 text-right font-mono tabular-nums">{money(row.serviceCostMinor, row.serviceCostCurrency)}</td>
                <td className="whitespace-nowrap px-4 py-5 text-right font-mono tabular-nums">{money(row.paidMinor, row.paidCurrency)}</td>
                <td className="min-w-[140px] px-4 py-5 text-xs text-fg-2">{row.needsReview ? "Нужно уточнить" : row.archived ? "В архиве" : ""}</td>
                <td className="px-4 py-3"><Link href={href({ record: row.id })} className={`${btnGhostCls} min-h-11 whitespace-nowrap`}>Открыть<span className="sr-only">: {row.applicantName || "Имя не указано"}</span></Link></td>
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
      {isAdmin ? <div className="mt-8 space-y-5 border-t border-border pt-5">
        {month && query.archived !== "true" ? <details><summary className="cursor-pointer py-3 text-sm font-medium">Изменить план месяца</summary><SalesTargetForm key={reportMonth} reportMonth={reportMonth} target={target} requestId={randomUUID()} readUnavailable={!workspace} /></details> : null}
        <details><summary className="cursor-pointer py-3 text-sm font-medium">Начальный перенос данных</summary><SalesRegisterImport requestId={randomUUID()} /></details>
      </div> : null}
    </>}
  </main>;
}
