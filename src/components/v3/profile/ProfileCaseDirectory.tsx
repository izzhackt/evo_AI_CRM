import Link from "next/link";
import { Pill, type PillTone } from "@/components/v3/Pill";
import { studentOperationalStage } from "@/lib/v3/wording";
import type { V3ProfileCaseDirectory, V3ProfileCaseDirectoryParams, V3ProfileCaseDirectoryRow } from "@/lib/v3/profile-source";
import { admissionsDirectoryHref, ATTENTION_LABELS, DIRECTION_LABELS } from "./admissions-view";

const STATE_COPY = { active: "В работе", closed: "Закрыто", pending: "Ожидает начала" } as const;
const STATE_TONE: Record<keyof typeof STATE_COPY, PillTone> = { active: "ok", closed: "neutral", pending: "warn" };
const INPUT = "min-h-11 min-w-0 w-full rounded-nav border border-control-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent";

function attention(row: V3ProfileCaseDirectoryRow): string | null {
  if (row.access !== "full") return "Только итог передачи";
  const needs = [
    row.overdueTaskCount ? `Просроченные задачи: ${row.overdueTaskCount}` : null,
    row.overdueObligationCount ? `Просроченная оплата: ${row.overdueObligationCount}` : null,
    row.rejectedDocumentCount ? `Документы на исправление: ${row.rejectedDocumentCount}` : null,
  ].filter(Boolean);
  return needs.length ? needs.join(" · ") : null;
}

export function ProfileCaseDirectory({ directory, initiallyOpen, params, curators = [], allowAdmissionsFilters = true }: Readonly<{
  directory: V3ProfileCaseDirectory; initiallyOpen: boolean; params: V3ProfileCaseDirectoryParams;
  curators?: readonly Readonly<{ membershipId: string; displayName: string }>[]; allowAdmissionsFilters?: boolean;
}>) {
  return <details className="min-w-0 rounded-card border border-border bg-surface" data-testid="v3-student-case-directory" open={initiallyOpen}>
    <summary className="min-h-11 cursor-pointer px-4 py-4 text-base font-semibold text-fg marker:text-fg-3 sm:px-5">
      Рабочий список <span className="ml-2 text-sm font-normal text-fg-2">{params.invalid ? "—" : `${directory.rows.length} на этой странице`}</span>
    </summary>
    <div className="min-w-0 space-y-5 border-t border-border px-4 py-5 sm:px-5">
      {allowAdmissionsFilters ? <nav aria-label="Направления поступления" className="flex flex-wrap gap-2">
        {[["", "Все направления"], ...Object.entries(DIRECTION_LABELS)].map(([value, label]) => <Link key={value}
          href={admissionsDirectoryHref({ ...params, direction: value ? value as V3ProfileCaseDirectoryParams["direction"] : undefined, cursor: null })}
          aria-current={(params.direction ?? "") === value ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-nav border px-3 text-sm font-medium ${(params.direction ?? "") === value ? "border-accent bg-accent-weak text-accent" : "border-control-edge text-fg-2 hover:bg-surface-2"}`}>{label}</Link>)}
      </nav> : null}
      <form key={JSON.stringify(params)} action="/v3/profile" method="get" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_auto]" aria-label="Найти студента">
        {params.direction ? <input type="hidden" name="direction" value={params.direction} /> : null}
        <label className="grid min-w-0 gap-1.5 text-sm font-medium text-fg-2">Имя, маршрут или страна
          <input className={INPUT} defaultValue={params.query} name="case_q" placeholder="Имя студента или страна" maxLength={200} />
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium text-fg-2">Статус дела
          <select className={INPUT} defaultValue={params.state ?? ""} name="case_status"><option value="">Все статусы</option><option value="pending">Ожидает начала</option><option value="active">В работе</option><option value="closed">Закрыто</option></select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="min-h-11 rounded-nav bg-accent px-4 text-sm font-semibold text-on-accent">Найти</button>
          <a className="inline-flex min-h-11 items-center rounded-nav border border-control-edge px-4 text-sm font-medium text-fg-2 hover:bg-surface-2" href="/v3/profile">Сбросить</a>
        </div>
        {allowAdmissionsFilters ? <details className="sm:col-span-2 xl:col-span-3" open={Boolean(params.curatorMembershipId || params.attention)}>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-fg-2">Дополнительные фильтры</summary>
          <div className="mt-2 grid max-w-2xl gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm text-fg-2">Куратор
              <select className={INPUT} name="curator" defaultValue={params.curatorMembershipId ?? ""}><option value="">Все доступные кураторы</option>
                {params.curatorMembershipId && !curators.some((item) => item.membershipId === params.curatorMembershipId) ? <option value={params.curatorMembershipId}>Выбранный куратор</option> : null}
                {curators.map((item) => <option key={item.membershipId} value={item.membershipId}>{item.displayName}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm text-fg-2">Требует внимания / этап
              <select className={INPUT} name="attention" defaultValue={params.attention ?? ""}><option value="">Без дополнительного фильтра</option>{Object.entries(ATTENTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </label>
          </div>
        </details> : null}
      </form>
      {params.invalid ? <p role="alert" className="rounded-nav border border-danger p-4 text-sm text-danger" data-testid="v3-student-case-filter-rejected">Не удалось применить фильтры. Проверьте запрос или сбросьте поиск.</p>
        : directory.rows.length === 0 ? <div className="space-y-2 py-8 text-center"><p className="font-medium text-fg">{params.active ? "По вашему запросу ничего не найдено." : "Пока нет доступных дел студентов."}</p><p className="text-sm text-fg-2">{params.active ? "Измените запрос или сбросьте фильтры." : "Здесь появятся дела после передачи из продаж."}</p></div>
        : <ul aria-label="Доступные дела студентов" className="divide-y divide-border">{directory.rows.map((row) => {
          const href = row.access === "full" ? `/v3/profile?case=${row.studentCaseId}&tab=route` : row.leadId ? `/v3/profile?id=${row.leadId}` : null;
          const issue = attention(row);
          return <li key={row.studentCaseId} className="grid min-w-0 gap-3 py-5 first:pt-0 sm:grid-cols-[minmax(160px,1fr)_minmax(200px,1.25fr)]" data-access={row.access} data-student-case-id={row.studentCaseId} data-testid="v3-student-case-row">
            <div className="min-w-0">
              {href ? <Link href={href} className="inline-flex min-h-11 items-center break-words text-base font-semibold text-fg hover:text-accent hover:underline">{row.studentDisplayName}</Link> : <p className="font-semibold text-fg">{row.studentDisplayName}</p>}
              <p className="text-sm text-fg-2">{row.admissionsDirection ? DIRECTION_LABELS[row.admissionsDirection] : row.targetCountry ?? "Направление не указано"}{row.targetDegree ? ` · ${row.targetDegree}` : ""}</p>
              <p className="mt-2 text-sm text-fg-3">Куратор: {row.admissionsDisplayName ?? "не назначен"}</p>
              {row.responsibleSalesDisplayName ? <p className="mt-1 text-xs text-fg-3">Передал: {row.responsibleSalesDisplayName}</p> : null}
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={STATE_TONE[row.state]}>{STATE_COPY[row.state]}</Pill><span className="text-sm text-fg-2">{row.operationalStage ? studentOperationalStage(row.operationalStage) : "Передано куратору"}</span></div>
              {row.access === "full" ? <p className="break-words text-sm leading-6 text-fg"><span className="font-medium">Следующий шаг: </span>{row.nextAction ?? "нужно назначить"}{row.nextActionDueOn ? <time className="ml-2 whitespace-nowrap text-fg-2" dateTime={row.nextActionDueOn}>до {row.nextActionDueOn.split("-").reverse().join(".")}</time> : null}</p> : null}
              {issue ? <p className={`text-sm ${row.access === "full" ? "text-danger" : "text-fg-3"}`}>{issue}</p> : null}
            </div>
          </li>;
        })}</ul>}
      <nav aria-label="Страницы каталога студентов" className="flex flex-wrap items-center justify-between gap-3">
        {params.cursor ? <Link className="inline-flex min-h-11 items-center text-sm font-medium text-fg-2 hover:text-fg" href={admissionsDirectoryHref(params)}>← К началу</Link> : <span />}
        {directory.hasNext && directory.nextCursor ? <Link className="inline-flex min-h-11 items-center text-sm font-medium text-fg-2 hover:text-fg" href={admissionsDirectoryHref(params, directory.nextCursor)} rel="next">Следующие записи →</Link> : null}
      </nav>
    </div>
  </details>;
}
