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

  return <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
    <SalesReportNavigation sales />
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Отчёт продаж</h1>
        <p className="mt-2 max-w-2xl text-sm text-fg-3">Продажи из воронки и записи отдела. Данные ведутся здесь, без синхронизации с Google.</p>
      </div>
      {!editing && workspace ? <Link href={href({ new: "true" })} className={`${btnCls} min-h-11`}>Добавить продажу</Link> : null}
    </header>

    {editing ? <div className="mt-6 max-w-[860px]">
      <SalesRegisterForm key={query.record ?? "new"} record={workspace?.selected ?? null}
        recordId={query.record ?? null} reportMonth={reportMonth} ownerOptions={workspace?.ownerOptions ?? []}
        isAdmin={isAdmin} requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={href()} readUnavailable={!workspace}
        ownMembershipId={actor.membershipId} ownLabel={actor.displayName} />
    </div> : <>
      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value="sales" />
        <label><span className={labelCls}>Год</span><input name="year" type="number" min="1900" max="2100" required defaultValue={valid ? year : ""} className={`${inputCls} min-h-11 w-28`} /></label>
        <label><span className={labelCls}>Месяц</span><select name="month" defaultValue={month ?? "all"} className={`${inputCls} min-h-11`}>
          <option value="all">Весь год</option>{MONTHS.map((title, i) => <option key={title} value={i + 1}>{title}</option>)}
        </select></label>
        <label><span className={labelCls}>Записи</span><select name="archived" defaultValue={query.archived === "true" ? "true" : "false"} className={`${inputCls} min-h-11`}>
          <option value="false">Рабочие</option><option value="true">Архив</option>
        </select></label>
        <button className={`${btnGhostCls} min-h-11`} type="submit">Показать</button>
      </form>
      {!workspace ? <div role="alert" className="mt-8 space-y-3 border-s-2 border-border ps-4 text-sm text-fg-2">
        <p>{valid ? "Не удалось загрузить отчёт. Проверьте подключение и повторите загрузку." : "Проверьте год, месяц и номер страницы."}</p>
        <Link href="/v3/main?view=sales" className={`${btnGhostCls} min-h-11`}>Открыть текущий месяц</Link>
      </div> : <>
        <section aria-label="Итоги периода" className="mt-8 border-y border-border py-5">
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <div><p className="text-sm text-fg-3">{query.archived === "true" ? "Записей в архиве" : "Записей продаж"}</p><p className="mt-1 font-mono text-2xl tabular-nums text-fg">{workspace.totalCount}</p></div>
            {isAdmin && month && query.archived !== "true" ? <div><p className="text-sm text-fg-3">План месяца</p><p className="mt-1 font-mono text-2xl tabular-nums text-fg">{target ? target.targetCount : "Не задан"}</p></div> : null}
          </div>
          {workspace.totals.length > 0 ? <div className="mt-5 max-w-xl">
            <div className="grid grid-cols-[3rem_1fr_1fr] gap-3 text-xs text-fg-3"><span>Валюта</span><span className="text-right">Стоимость</span><span className="text-right">Оплачено по записям</span></div>
            {workspace.totals.map(t => <div key={t.currency} className="mt-3 grid grid-cols-[3rem_1fr_1fr] gap-3 text-sm tabular-nums"><span>{t.currency}</span><span className="text-right">{number.format(t.costMinor / 100)}</span><span className="text-right">{number.format(t.paidMinor / 100)}</span></div>)}
            <p className="mt-3 text-xs text-fg-3">Накопленные суммы по записям, не поступления за месяц. Валюты не пересчитываются.</p>
          </div> : null}
          {workspace.unresolvedCostCount > 0 || workspace.unresolvedPaidCount > 0 ? <p className="mt-4 text-sm text-fg-2">В денежные итоги не включены неуточнённые значения: стоимость — {workspace.unresolvedCostCount}, оплата — {workspace.unresolvedPaidCount}.</p> : null}
        </section>

        {workspace.rows.length === 0 ? <p className="py-12 text-sm text-fg-3">{offset > 0 ? "На этой странице записей нет. Вернитесь к началу списка." : "В выбранном периоде записей нет."}</p> : <ul className="mt-3 divide-y divide-border">
          {workspace.rows.map(row => <li key={row.id} className="grid gap-3 py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0"><Link href={href({ record: row.id })} className="inline-flex min-h-11 items-center break-words font-medium text-fg underline-offset-4 hover:underline">{row.applicantName || "Имя не указано"}</Link>
              <p className="break-words text-sm text-fg-3">{[row.country, row.program].filter(Boolean).join(" · ") || "Программа не указана"}</p>
              <p className="mt-1 text-xs text-fg-3">{row.managerLabel || "Менеджер не указан"} · {dateLabel(row.signingDate)}</p>
            </div>
            <div className="text-sm"><span className="block text-xs text-fg-3">Стоимость</span><span className="mt-1 block tabular-nums">{money(row.serviceCostMinor, row.serviceCostCurrency)}</span></div>
            <div className="text-sm"><span className="block text-xs text-fg-3">Оплачено по записи</span><span className="mt-1 block tabular-nums">{money(row.paidMinor, row.paidCurrency)}</span></div>
            <div className="text-xs text-fg-3">{row.needsReview ? "Нужно уточнить" : row.archived ? "В архиве" : ""}</div>
          </li>)}
        </ul>}
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
