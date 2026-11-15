import Link from "next/link";

import { QueueTabStrip } from "./QueueTabStrip";

export type QueueTab = Readonly<{
  key: string;
  label: string;
  href: string;
  /** null — числа для этого вида нет в чтении; не выдумываем. */
  count: number | null;
  current: boolean;
}>;

/**
 * Вкладки-виды очереди («Мои · Поставил я · Вся команда»): настоящие ссылки с
 * адресом и `aria-current="page"`, выбранная — общий `.v3-choice`. Число —
 * табличные цифры Golos и только там, где его дало чтение. Ряд никогда не
 * переносится (высота шапки не меняется, когда рядом открыта панель): лишнее
 * прокручивается вбок внутри ряда, текущая вкладка видна (`QueueTabStrip`).
 */
export function QueueViewTabs({ label, tabs, id, focusable = false }: Readonly<{
  label: string;
  tabs: readonly QueueTab[];
  /** Якорь ряда вкладок (например, прежний адрес `#admissions-summary`). */
  id?: string;
  /** Вкладки профиля: ряд сам принимает фокус — на него возвращается фокус после ответа в панели (`QueueTabStrip`). */
  focusable?: boolean;
}>) {
  return (
    <QueueTabStrip id={id} label={label} focusable={focusable}>
      {/* Без линии под рядом (14.11.2026, «выбранное выделено дважды»): выбранную вкладку отмечает одна нейтральная плашка.
          Ряд ровно по высоте вкладки, поэтому рамка фокуса рисуется внутри (`data-tab-ring`, staff.css) и не обрезается. */}
      <ul className="flex min-w-max items-center gap-1" data-tab-ring="inset">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              scroll={false}
              aria-current={tab.current ? "page" : undefined}
              className="v3-choice inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-nav px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg"
            >
              {tab.label}
              {tab.count !== null ? <span className="tabular-nums text-fg-3">{tab.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </QueueTabStrip>
  );
}
