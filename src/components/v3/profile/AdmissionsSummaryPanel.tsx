import Link from "next/link";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { V3ProfileCaseDirectoryParams } from "@/lib/v3/profile-source";
import { readAdmissionsSummary } from "@/lib/v3/admissions-source";
import { admissionsDirectoryHref, DIRECTION_LABELS } from "./admissions-view";
import { AdmissionsSummaryReport } from "./AdmissionsSummaryReport";

/**
 * Сводка по направлениям (unified workflow S4, plan §12: «показываем только
 * сведения, которые реально ведём»). «Ждём партнёра» и «Прибыли за месяц»
 * (и вместе с ними — выбор месяца прибытия) убраны: submission/visa/arrival
 * больше не отслеживаются как этапы. Вместо «Ждём партнёра» — «Нужно
 * назначить куратора» (S3's `needs_curator`, тот же флаг, что уже красит
 * строку в «Студентах»).
 */
export async function AdmissionsSummaryPanel({ actor, params, expanded = false }: { actor: ActivePlatformActor; params: V3ProfileCaseDirectoryParams; expanded?: boolean }) {
  if (params.invalid) return <p role="alert" className="text-sm text-danger">Проверьте фильтры отчёта. <Link href="/v3/profile" className="underline">Сбросить</Link></p>;
  const summary = await readAdmissionsSummary(actor, { direction: params.direction, curatorMembershipId: params.curatorMembershipId }).catch(() => null);
  if (!summary) return <p role="alert" className="rounded-card border border-border bg-surface p-4 text-sm text-fg-2">Сводка пока недоступна. Ниже можно продолжить работу со списком дел. <a href={admissionsDirectoryHref(params)} className="underline">Повторить загрузку</a></p>;
  const active = summary.stock.reduce((sum, item) => sum + item.active, 0);
  const overdue = summary.stock.reduce((sum, item) => sum + item.overdue, 0);
  const needsCurator = summary.stock.reduce((sum, item) => sum + item.needs_curator, 0);
  const linkParams = { ...params, query: undefined, state: undefined, cursor: null, attention: undefined };
  return <section className="space-y-4" aria-label="Сводка по поступлению">
    <div><h2 className="text-xl font-semibold text-fg">Поступление в работе</h2><p className="mt-1 text-sm text-fg-2">{actor.presentationRole === "admissions" ? "Только дела в вашем доступе." : "Все доступные дела выбранных направлений и кураторов."} Показатели не ограничены текущей страницей списка.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Дела в работе сейчас" value={active} href={admissionsDirectoryHref({ ...linkParams, state: "active" })} />
      <Metric label="Есть просрочки" value={overdue} href={admissionsDirectoryHref({ ...linkParams, attention: "overdue" })} />
      <Metric label="Нужно назначить куратора" value={needsCurator} href={admissionsDirectoryHref({ ...linkParams, attention: "needs_curator" })} />
    </div>
    <AdmissionsSummaryReport expanded={expanded}>
      <p className="mb-3 text-sm leading-6 text-fg-2">«В работе» и ожидания — состояние сейчас. Просрочки включают следующий шаг, задачи и исправления. «Нужно назначить куратора» — дело с продажей, где отклонили назначение куратора.</p>
      <ul className="divide-y divide-border">{summary.stock.map((row) => <li key={row.direction} className="grid gap-3 py-4 sm:grid-cols-[140px_1fr]">
        <Link href={admissionsDirectoryHref({ ...linkParams, direction: row.direction })} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">{DIRECTION_LABELS[row.direction]}</Link>
        <dl className="grid grid-cols-3 gap-3 text-sm"><div><dt className="text-xs text-fg-3">В работе</dt><dd className="mt-1 font-semibold text-fg">{row.active}</dd></div><div><dt className="text-xs text-fg-3">Есть просрочки</dt><dd className="mt-1 text-fg">{row.overdue}</dd></div><div><dt className="text-xs text-fg-3">Нужно назначить куратора</dt><dd className="mt-1 text-fg">{row.needs_curator}</dd></div></dl>
      </li>)}</ul>
    </AdmissionsSummaryReport>
  </section>;
}
function Metric({ label, value, href }: { label: string; value: number; href?: string }) {
  const contents = <><span className="text-sm text-fg-2">{label}</span><span className="mt-2 block text-3xl font-semibold tracking-tight text-fg">{value}</span></>;
  const className = "min-h-28 rounded-card border border-border bg-surface p-4";
  return href ? <Link href={href} className={`${className} hover:border-control-edge`}>{contents}<span className="sr-only"> — открыть дела</span></Link> : <div className={className}>{contents}</div>;
}
