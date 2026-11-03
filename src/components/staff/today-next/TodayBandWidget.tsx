import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { TodayItem } from "@/lib/v3/today-queue";

import { taskPanelHref } from "../tasks/TaskQueueList";
import { TaskQueueRow, type RecentCompletion, type TaskRowPermissions } from "../tasks/TaskQueueRow";
import type { CompletionBand } from "../tasks/useRecentCompletions";
import { TodayRow } from "../today/TodayRow";
import { todayBandTitle, todayWidgetId } from "./TodayTiles";

/** Строк виджета до «Показать ещё»: виджет остаётся короткой карточкой, а не стеной строк. */
export const WIDGET_ROWS = 5;
/** Группа не длиннее окна плюс запас показывается целиком: «Показать ещё 1» ради одной строки — лишняя кнопка. */
const WIDGET_SLACK = 2;

export function widgetVisibleCount(total: number, expanded: boolean): number {
  return expanded || total <= WIDGET_ROWS + WIDGET_SLACK ? total : WIDGET_ROWS;
}

/**
 * Виджет одной группы «Сегодня». Строки — те же, что у прежнего вида: задача — настоящая строка «Задач» (круг
 * завершения, «Отменить», «⋯»), остальное — `TodayRow` с «Открыть» и «Позвонить». Одна причина на всю группу стоит
 * один раз под заголовком; предупреждение «числа нет» остаётся на виду.
 */
export function TodayBandWidget({
  band,
  note,
  hoisted,
  expanded,
  onToggle,
  nowIso,
  permissions,
  dial,
  taskLeads,
  recent,
  announce,
  onCompleted,
}: Readonly<{
  band: CompletionBand<TodayItem>;
  note: string | null;
  hoisted: boolean;
  expanded: boolean;
  onToggle: (button: HTMLButtonElement) => void;
  nowIso: string;
  permissions: TaskRowPermissions;
  dial: DialOptions | null;
  taskLeads: Readonly<Record<string, Readonly<{ leadId: string; name: string; href: string }>>> | null;
  recent: Readonly<Record<string, RecentCompletion>>;
  announce: (text: string) => void;
  onCompleted: (item: TodayItem, index: number, completion: RecentCompletion) => void;
}>) {
  const visible = widgetVisibleCount(band.rows.length, expanded);
  const hidden = band.rows.length - widgetVisibleCount(band.rows.length, false);
  return (
    <WidgetCard
      id={todayWidgetId(band.key)}
      title={todayBandTitle(band.label)}
      bodyClassName="px-0"
    >
      {/* Строки виджета всегда двухстрочные (`stacked`): в половине страницы широкая сетка со сроком в колонке обрезала бы названия. */}
      <section className="min-w-0">
        {note ? <p className="px-5 pb-2 t-meta text-fg-2" data-today-band-note="">{note}</p> : null}
        <ul className="[&>li:last-child]:border-b-0">
          {band.rows.slice(0, visible).map((item, index) => item.task ? (
            <TaskQueueRow
              key={item.key}
              task={item.task}
              href={taskPanelHref({}, item.task)}
              moveHref={taskPanelHref({}, item.task, true)}
              selected={false}
              open
              showAssignee={false}
              nowIso={nowIso}
              permissions={permissions}
              recent={recent[item.key] ?? null}
              leadRef={taskLeads?.[item.key] ?? null}
              dial={dial}
              hideTodayWord={band.key === "today"}
              stacked
              announce={announce}
              onCompleted={(completion) => onCompleted(item, index, completion)}
            />
          ) : <TodayRow key={item.key} item={item} nowIso={nowIso} dial={dial} hideReason={hoisted} stacked />)}
        </ul>
        {/* Кнопка стоит внутри секции группы: клавиатура очереди (j/k) продолжает от последней строки этой группы. */}
        {hidden > 0 ? (
          <div className="border-t border-border px-4 pt-3">
            <Button variant="ghost" data-today-more={band.key} aria-expanded={expanded} onClick={(event) => onToggle(event.currentTarget)}>
              {expanded ? "Свернуть" : `Показать ещё ${hidden}`}
            </Button>
          </div>
        ) : null}
      </section>
    </WidgetCard>
  );
}
