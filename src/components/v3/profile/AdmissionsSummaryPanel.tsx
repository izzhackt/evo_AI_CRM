import Link from "next/link";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { V3ProfileCaseDirectoryParams } from "@/lib/v3/profile-source";
import { readAdmissionsSummary } from "@/lib/v3/admissions-source";
import { admissionsReportPeriod } from "@/lib/admissions-report-period";
import { admissionsDirectoryHref, DIRECTION_LABELS } from "./admissions-view";

export async function AdmissionsSummaryPanel({ actor, params, period }: { actor: ActivePlatformActor; params: V3ProfileCaseDirectoryParams; period?: string }) {
  const selected = admissionsReportPeriod(period);
  if (!selected || params.invalid) return <p role="alert" className="text-sm text-danger">Проверьте период и фильтры отчёта. <Link href="/v3/profile" className="underline">Сбросить</Link></p>;
    const summary = await readAdmissionsSummary(actor, { direction: params.direction, curatorMembershipId: params.curatorMembershipId, periodFrom: selected.from, periodTo: selected.to }).catch(() => null);
    if (!summary) return <p role="alert" className="rounded-card border border-border bg-surface p-4 text-sm text-fg-2">Сводка пока недоступна. Ниже можно продолжить работу со списком дел. <a href={admissionsDirectoryHref(params)} className="underline">Повторить загрузку</a></p>;
    const active = summary.stock.reduce((sum, item) => sum + item.active, 0);
    const overdue = summary.stock.reduce((sum, item) => sum + item.overdue, 0);
    const partner = summary.stock.reduce((sum, item) => sum + item.awaiting_partner, 0);
    const arrivals = summary.periodArrivals.reduce((sum, item) => sum + item.count, 0);
    const linkParams = { ...params, query: undefined, state: undefined, cursor: null, attention: undefined };
    return <section className="space-y-4" aria-label="Сводка по поступлению">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-fg">Поступление в работе</h2><p className="mt-1 text-sm text-fg-2">{actor.presentationRole === "admissions" ? "Только дела в вашем доступе." : "Все доступные дела выбранных направлений и кураторов."} Показатели не ограничены текущей страницей списка.</p></div>
        <form action="/v3/profile" method="get" className="flex flex-wrap items-end gap-2">
          {params.direction ? <input type="hidden" name="direction" value={params.direction} /> : null}{params.curatorMembershipId ? <input type="hidden" name="curator" value={params.curatorMembershipId} /> : null}
          <label className="grid gap-1 text-xs text-fg-2">Месяц прибытия<input type="month" name="period" defaultValue={selected.month} min="1970-01" max="2100-12" className="min-h-11 rounded-nav border border-control-edge bg-surface px-3 text-sm text-fg" /></label><button type="submit" className="min-h-11 rounded-nav border border-control-edge bg-surface px-3 text-sm font-medium text-fg">Показать</button>
        </form>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Дела в работе сейчас" value={active} href={admissionsDirectoryHref({ ...linkParams, state: "active" })} />
        <Metric label="Просрочен следующий шаг" value={overdue} href={admissionsDirectoryHref({ ...linkParams, attention: "overdue" })} />
        <Metric label="Ждём партнёра" value={partner} href={admissionsDirectoryHref({ ...linkParams, attention: "awaiting_partner" })} />
        <Metric label={`Прибыли за ${selected.month}`} value={arrivals} />
      </div>
      <details className="rounded-card border border-border bg-surface p-4 sm:p-5"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-fg">Короткий отчёт по направлениям</summary>
        <p className="mb-3 text-sm leading-6 text-fg-2">«В работе» и ожидания — состояние сейчас. «Прибыли» — уникальные дела с подтверждённым прибытием за выбранный месяц. Отменённые дела не считаются прибытием.</p>
        <ul className="divide-y divide-border">{summary.stock.map((row) => <li key={row.direction} className="grid gap-3 py-4 sm:grid-cols-[140px_1fr]">
          <Link href={admissionsDirectoryHref({ ...linkParams, direction: row.direction })} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">{DIRECTION_LABELS[row.direction]}</Link>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><dt className="text-xs text-fg-3">В работе</dt><dd className="mt-1 font-semibold text-fg">{row.active}</dd></div><div><dt className="text-xs text-fg-3">Ждём партнёра</dt><dd className="mt-1 text-fg">{row.awaiting_partner}</dd></div><div><dt className="text-xs text-fg-3">Просрочен шаг</dt><dd className="mt-1 text-fg">{row.overdue}</dd></div><div><dt className="text-xs text-fg-3">Прибыли за месяц</dt><dd className="mt-1 text-fg">{summary.periodArrivals.find((item) => item.direction === row.direction)?.count ?? 0}</dd></div></dl>
        </li>)}</ul>
      </details>
    </section>;
}
function Metric({ label, value, href }: { label: string; value: number; href?: string }) {
  const contents = <><span className="text-sm text-fg-2">{label}</span><span className="mt-2 block text-3xl font-semibold tracking-tight text-fg">{value}</span></>;
  const className = "min-h-28 rounded-card border border-border bg-surface p-4";
  return href ? <Link href={href} className={`${className} hover:border-control-edge`}>{contents}<span className="sr-only"> — открыть дела</span></Link> : <div className={className}>{contents}</div>;
}
