import Link from "next/link";

import { Icon } from "@/components/icons";
import {
  REPORT_MISSED_LIST_LIMIT,
  REPORT_PHONE_CELLS,
  reportCells,
  reportIsEmpty,
  reportMoment,
  reportRowIsIdle,
  reportSummary,
  unassignedCells,
  type ReportCell,
  type TelephonyReport,
  type TelephonyReportState,
} from "@/lib/v3/telephony-report";

import { MainHeader, type PeriodChoice } from "./MainHeader";
import { QUEUE_QUIET_LINK } from "./queue/QueueStates";

/**
 * Ячейки строки: подпись, главное число и мелкие пояснения. Пары «подпись — значение» в `dl`:
 * от `sm` три колонки, от `lg` — шесть в ряд. Таблицы нет — ни горизонтальной прокрутки, ни повторной
 * разметки для узкого экрана. На телефоне строка менеджера — три главные ячейки в ряд («Звонки»,
 * «Отвечено», «Пропущенные без перезвона»), остальные три и вторые строки пояснений главных ячеек («исходящие
 * 1 из 2», «перезвонили в срок…») раскрываются по «Все показатели»: пять менеджеров не занимают две тысячи
 * пикселей, а ни одно пояснение на телефоне не теряется.
 */
const FULL_GRID = "grid grid-cols-3 gap-x-3 gap-y-4 sm:gap-x-4 lg:grid-cols-6";
/** Строка «Без ответственного» несёт две ячейки: они стоят слева двумя колонками, а не растянуты на шесть. */
const SHORT_GRID = "grid max-w-xl grid-cols-2 gap-x-4 gap-y-4";
const QUIET_SUMMARY = "inline-flex min-h-11 cursor-pointer list-none items-center t-meta text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden";

/**
 * Одна ячейка: крупная цифра, а когда числа нет — спокойное слово («ждём»), не прочерк и не крупный шрифт.
 * `firstNoteOnly` — главная ячейка телефона: рядом с цифрой одна короткая строка, остальные пояснения не
 * потеряны, а стоят в «Все показатели» (`NotesOnly`). `Cell` без `firstNoteOnly` — полная ячейка.
 */
function Cell({ cell, className = "", firstNoteOnly = false }: Readonly<{ cell: ReportCell; className?: string; firstNoteOnly?: boolean }>) {
  return (
    <div className={`min-w-0 ${className}`} title={cell.hint}>
      <dt className="t-caption text-fg-2">{cell.label}</dt>
      <dd className={cell.quiet ? "t-body-compact text-fg-2" : "t-figure tabular-nums text-fg"}>{cell.figure}</dd>
      {cell.notes.map((note, index) => <dd key={note} className={`t-meta text-fg-3${firstNoteOnly && index > 0 ? " max-sm:hidden" : ""}`}>{note}</dd>)}
    </div>
  );
}

/**
 * Пояснения главной ячейки целиком, без повторной цифры — для «Все показатели» на телефоне: разбивка «исходящие 1 из 2»,
 * «перезвонили в срок / позже срока / срок ещё не вышел» не пропадает вместе со строками, скрытыми в ряду главных ячеек.
 */
function NotesOnly({ cell }: Readonly<{ cell: ReportCell }>) {
  return (
    <div className="min-w-0" title={cell.hint} data-calls-notes="">
      <dt className="t-caption text-fg-2">{cell.label}</dt>
      {cell.notes.map((note) => <dd key={note} className="t-meta text-fg-3">{note}</dd>)}
    </div>
  );
}

function Cells({ cells, grid = FULL_GRID, phoneSplit = false }: Readonly<{ cells: readonly ReportCell[]; grid?: string; phoneSplit?: boolean }>) {
  const isPrimary = (index: number) => !phoneSplit || (REPORT_PHONE_CELLS as readonly number[]).includes(index);
  // Что телефон спрятал из главных ячеек (вторая и следующие строки) — за «Все показатели», вместе с остальными тремя ячейками.
  const hasMoreNotes = (cell: ReportCell) => cell.notes.length > 1;
  return (
    <>
      <dl className={`mt-3 ${grid}`}>
        {cells.map((cell, index) => <Cell key={cell.label} cell={cell} className={isPrimary(index) ? "" : "max-sm:hidden"} firstNoteOnly={phoneSplit} />)}
      </dl>
      {phoneSplit ? (
        <details className="mt-1 sm:hidden" data-calls-all="">
          <summary className={QUIET_SUMMARY}>Все показатели</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-4">
            {cells.map((cell, index) => !isPrimary(index) ? <Cell key={cell.label} cell={cell} /> : hasMoreNotes(cell) ? <NotesOnly key={cell.label} cell={cell} /> : null)}
          </dl>
        </details>
      ) : null}
    </>
  );
}

function Everyone({ report, id }: Readonly<{ report: TelephonyReport; id: string }>) {
  const { team, unassigned, managers, slaMinutes } = report;
  return (
    <>
      {team ? (
        <section aria-labelledby={`${id}-team`} className="min-w-0" data-calls-team="">
          <h3 id={`${id}-team`} className="t-item text-fg">Вся команда</h3>
          <Cells cells={reportCells(team, slaMinutes)} phoneSplit />
        </section>
      ) : null}
      <section aria-labelledby={`${id}-managers`} className="min-w-0" data-calls-managers="">
        <h3 id={`${id}-managers`} className="t-item text-fg">Менеджеры</h3>
        {managers.length === 0 ? (
          <p className="mt-3 border-y border-border py-6 text-center t-body-compact text-fg-3">Нет сотрудников со звонками за период.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {managers.filter((row) => !reportRowIsIdle(row)).map((row) => (
              <li key={row.membershipId} className="py-3" data-calls-manager={row.membershipId}>
                <h4 className="t-label text-fg">{row.name}</h4>
                <Cells cells={reportCells(row, slaMinutes)} phoneSplit />
              </li>
            ))}
            {/* Строки из одних нулей не нужны: сотрудники без звонков, лидов и пропущенных — одной строкой. */}
            {managers.some(reportRowIsIdle) ? (
              <li className="py-3 t-meta text-fg-2" data-calls-idle="">
                Без звонков за период: {managers.filter(reportRowIsIdle).map((row) => row.name).join(", ")}
              </li>
            ) : null}
            {unassigned ? (
              <li className="py-3" data-calls-unassigned="">
                <h4 className="t-label text-fg">Без ответственного</h4>
                <p className="t-meta text-fg-3">Лиды и пропущенные звонки, у которых нет владельца.</p>
                <Cells cells={unassignedCells(unassigned, slaMinutes)} grid={SHORT_GRID} />
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </>
  );
}

function Own({ report, id }: Readonly<{ report: TelephonyReport; id: string }>) {
  const row = report.managers[0];
  return (
    <section aria-labelledby={`${id}-own`} className="min-w-0" data-calls-own="">
      <h3 id={`${id}-own`} className="t-item text-fg">Ваши цифры</h3>
      <Cells cells={reportCells(row, report.slaMinutes)} phoneSplit />
    </section>
  );
}

function MissedList({ report, id }: Readonly<{ report: TelephonyReport; id: string }>) {
  if (report.missedList.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-missed`} className="min-w-0" data-calls-missed-list="">
      <h3 id={`${id}-missed`} className="t-item text-fg">Пропущенные без перезвона</h3>
      <p className="t-meta text-fg-3">
        Входящие, на которые до конца следующего рабочего дня никто не ответил по этому номеру.
      </p>
      <ol className="mt-2 border-t border-border">
        {report.missedList.map((item) => (
          <li key={item.callId} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-2" data-missed-call={item.callId}>
            <time dateTime={item.startedAt} className="t-label tabular-nums text-fg">{reportMoment(item.startedAt)}</time>
            <span className="t-body-compact tabular-nums text-fg-2">{item.phone}</span>
            <span className="t-meta text-fg-3">{item.ownerName ?? "Без ответственного"}</span>
            {item.leadId ? <Link href={`/v3/profile?id=${encodeURIComponent(item.leadId)}`} className={QUEUE_QUIET_LINK}>Открыть лид</Link> : null}
          </li>
        ))}
      </ol>
      {report.missedMore ? (
        <p className="mt-2 t-meta text-fg-3">Показаны последние {REPORT_MISSED_LIST_LIMIT}.</p>
      ) : null}
    </section>
  );
}

/**
 * Блок «Звонки» «Отчёта продаж» («Телефония Beeline KG», срез T10; план §10, §12): по каждому
 * менеджеру звонки, доля отвеченных, время разговора, время до первого звонка по новым лидам,
 * пропущенные без перезвона и доля проставленных результатов; для руководителя — ещё строка «Вся
 * команда», строка «Без ответственного» и список пропущенных без перезвона. Менеджер с правом «свои»
 * видит одну свою строку. Свёрнут, как «Динамика по дням»; открыт, когда в адресе выбран период, и
 * делит с ним период.
 *
 * Выключено, нет права и просмотр роли — блока нет вообще (`off`): пока включатель `ui_enabled`
 * выключен, отчёт такой же, как без телефонии. Чтение не удалось — так и сказано, нуля наугад нет.
 * Облик спокойный (DESIGN.md): плоские списки на волосяных линиях, числа без рамок, ссылки тихие,
 * красного нет.
 */
export function SalesCallsReport({
  id,
  open,
  choices,
  range,
  periodText,
  formAction,
  carry,
  retryHref,
  state,
}: Readonly<{
  id: string;
  open: boolean;
  choices: readonly PeriodChoice[];
  range: Readonly<{ from: string; to: string; max: string }> | null;
  /** «1–26 сентября» — подпись выбранного периода. */
  periodText: string;
  formAction: string;
  carry: Readonly<Record<string, string>>;
  retryHref: string;
  state: TelephonyReportState;
}>) {
  if (state.status === "off") return null;
  const report = state.status === "ready" ? state.report : null;
  return (
    <details id={id} open={open} className="group mt-8 scroll-mt-4 border-t border-border pt-2" data-testid="v3-sales-calls">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 rounded-nav text-fg [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        <h2 className="t-section">Звонки</h2>
        {/* Свёрнутый блок говорит главное сам, с периодом: он не месяц отчёта выше, а период «Динамики по дням». */}
        {report ? <span className="min-w-0 t-meta text-fg-2 group-open:hidden" data-testid="v3-sales-calls-summary">{periodText} · {reportSummary(report)}</span> : null}
      </summary>

      <div className="mt-4 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="t-item text-fg">{report?.scope === "own" ? "Ваши звонки за период" : "Звонки за период"}</p>
            <p className="t-meta text-fg-3">
              {periodText}
              {report ? ` · первый звонок и перезвон — в течение ${report.slaMinutes} мин рабочего времени` : ""}
            </p>
          </div>
          <MainHeader choices={choices} range={range} action={formAction} hidden={carry} />
        </div>

        {report === null ? (
          <div role="alert" className="border-y border-border py-6 t-body-compact text-fg-2">
            <p>Не удалось загрузить звонки за выбранный период.</p>
            <Link className={QUEUE_QUIET_LINK} href={retryHref}>Повторить</Link>
          </div>
        ) : reportIsEmpty(report) ? (
          <p className="border-y border-border py-8 text-center t-body-compact text-fg-3">За этот период звонков, новых лидов и пропущенных нет.</p>
        ) : (
          <>
            {report.scope === "all" ? <Everyone report={report} id={id} /> : <Own report={report} id={id} />}
            <MissedList report={report} id={id} />
          </>
        )}
      </div>
    </details>
  );
}
