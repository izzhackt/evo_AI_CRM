import Link from "next/link";

import { EvoMark } from "@/components/platform/brand/EvoMark";

/**
 * Шапка главной: знак и имя слева, период справа. Одна строка высоты.
 *
 * Выбрано заказчиком из четырёх вариантов фирменного блока. Крупный
 * центральный блок отклонён — он сдвинул бы цифры за первый экран; изразцовое
 * поле из логобука отклонено — книга запрещает его под плотными рабочими
 * данными.
 *
 * Знак берётся в моно-исполнении (`tone="mono"` — заливка `currentColor`), а
 * цвет ему задаёт текстовый класс мира. Логобук такое исполнение разрешает, и
 * оно не приносит сюда фирменный красный, которого в этой пробе нет. Размер
 * задаётся одним числом, поэтому пропорции не искажаются; эффектов нет.
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
}: {
  choices: readonly PeriodChoice[];
  /** Поля произвольного диапазона. null — выбран не «Период». */
  range: PeriodRange | null;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-[-0.01em] text-fg">
          <EvoMark size={22} tone="mono" className="shrink-0" />
          EVO Admissions
        </h1>

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
                  className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-nav px-3 text-sm ${
                    choice.active
                      ? "bg-accent font-medium text-on-accent"
                      : "text-fg-2 hover:bg-surface-2"
                  }`}
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
          action="/v3/main"
          className="flex flex-wrap items-center gap-2 sm:justify-end"
        >
          <input type="hidden" name="period" value="custom" />

          {/* Подпись — сама метка, а не `aria-label`: видимое слово и то, что
              слышит читалка, обязаны совпадать. */}
          {/* Обе границы обязательны: диапазон с одним концом — это не
              диапазон. Раньше форма отправлялась с пустым полем, сервер
              выбрасывал обе даты и молча показывал последние тридцать дней —
              человек называл день, а получал месяц и не узнавал об этом. */}
          <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3">
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

          <label className="inline-flex items-center gap-1.5 text-2xs text-fg-3">
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

          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-ctl bg-accent px-4 text-sm font-medium text-on-accent"
          >
            Показать
          </button>
        </form>
      ) : null}
    </header>
  );
}
