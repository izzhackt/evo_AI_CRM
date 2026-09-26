import Link from "next/link";

import { btnGhostCls } from "@/components/ui";

/**
 * Переключатель периода раздела «Динамика по дням» «Отчёта продаж» (Э3,
 * 26.09.2026: графики ушли со стартовой страницы «Сегодня»). Заголовок
 * страницы — у отчёта, чтобы на странице был ровно один `h1`.
 *
 * ПЕРЕКЛЮЧАТЕЛЬ ПЕРИОДА — ССЫЛКИ, А НЕ КНОПКИ С СОСТОЯНИЕМ. Период живёт в
 * адресе, поэтому экран можно переслать целиком и вернуться к прошлому
 * периоду кнопкой браузера. Ролей `tablist`/`tab` здесь нет: это переходы, и
 * читалка должна назвать их ссылками; текущий помечен `aria-current`.
 *
 * «Период» по той же причине задаётся формой методом GET: две даты уходят в
 * адрес и живут там наравне с остальными. Оба поля обязательны, а адрес,
 * набранный руками, разбирает сервер: там же лежит и предел длины диапазона.
 */

export type PeriodChoice = Readonly<{
  key: string;
  title: string;
  href: string;
  active: boolean;
}>;

export type PeriodRange = Readonly<{
  from: string;
  to: string;
  /** Дальше сегодняшнего дня данных не бывает. */
  max: string;
}>;

export function MainHeader({
  choices,
  range,
  action = "/v3/main",
  hidden = {},
}: {
  choices: readonly PeriodChoice[];
  /** Поля произвольного диапазона. null — выбран не «Период». */
  range: PeriodRange | null;
  /** Адрес формы диапазона (с якорем раздела). */
  action?: string;
  /** Параметры страницы, которые форма диапазона несёт с собой (вид и фильтры отчёта). */
  hidden?: Readonly<Record<string, string>>;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-3">
        {/* Пять названий не помещаются в 393px, поэтому полоса прокручивается.
            Прокручиваемой области нужен клавиатурный доступ (SC 2.1.1) и
            собственное имя. */}
        <nav
          aria-label="Период"
          tabIndex={0}
          className="min-w-0 max-w-full overflow-x-auto"
        >
          <ul className="flex w-max items-center gap-0.5 rounded-ctl border border-border bg-surface p-0.5">
            {choices.map((choice) => (
              <li key={choice.key}>
                <Link
                  href={choice.href}
                  aria-current={choice.active ? "page" : undefined}
                  className="v3-choice inline-flex min-h-11 items-center whitespace-nowrap rounded-nav px-3 text-sm text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  {choice.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {range ? (
        // Диапазон встаёт под тем переключателем, который его открыл, а на
        // узком экране — по левому краю, как всё остальное содержимое.
        <form
          method="get"
          action={action}
          className="flex flex-wrap items-center gap-2 sm:justify-end"
        >
          {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <input type="hidden" name="period" value="custom" />

          {/* Подпись — сама метка, а не `aria-label`: видимое слово и то, что
              слышит читалка, обязаны совпадать. */}
          {/* Обе границы обязательны: диапазон с одним концом — это не
              диапазон. Раньше форма отправлялась с пустым полем, сервер
              выбрасывал обе даты и молча показывал последние тридцать дней —
              человек называл день, а получал месяц и не узнавал об этом. */}
          <label className="inline-flex items-center gap-2 text-sm text-fg-2">
            Начало
            <input
              type="date"
              name="from"
              required
              defaultValue={range.from}
              max={range.max}
              className="min-h-11 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm text-fg"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-fg-2">
            Конец
            <input
              type="date"
              name="to"
              required
              defaultValue={range.to}
              max={range.max}
              className="min-h-11 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm text-fg"
            />
          </label>

          <button type="submit" className={btnGhostCls}>
            Показать
          </button>
        </form>
      ) : null}
    </header>
  );
}
