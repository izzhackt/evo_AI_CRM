import Link from "next/link";
import type { DragEventHandler, ReactNode } from "react";

import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";

/**
 * Общий примитив двух досок CRM — «Воронки продаж» и «Воронки поступления»
 * (решение владельца 25.09.2026: доска на всю ширину, без прокрутки вбок).
 *
 * Доска — CSS grid на всю ширину области под строкой инструментов: колонки
 * тянутся по доступной ширине, по левому краю, и прокручиваются внутри себя
 * по высоте окна. Колонки разделены волосяными линиями, без серых «колодцев»:
 * карточка остаётся единственной рамкой, вложенных коробок нет.
 */

/** Пустая колонка — одна тихая строка. */
export const BOARD_EMPTY = { leads: "Нет лидов", cases: "Нет дел" } as const;

export {
  BOARD_FLUID_TRACK,
  BOARD_RAIL_TRACK,
  boardTracks,
  cappedBoardTracks,
} from "@/components/v3/board/board-tracks";

/** Оболочка карточки: одна рамка, наведение — край контрола. */
export const BOARD_CARD_CLASS =
  "group relative min-w-0 rounded-ctl border border-border bg-surface px-3 py-2 hover:border-control-edge focus-within:border-control-edge";

/** Захват для перетаскивания: виден при наведении и фокусе внутри карточки. */
export function BoardGrip() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute start-0 top-2.5 hidden text-fg-3 group-hover:block group-focus-within:block">
      <Icon name="grip-vertical" size={12} />
    </span>
  );
}

export function BoardColumn({
  headingId,
  title,
  count,
  marker,
  headerAction,
  emptyText,
  className,
  highlighted = false,
  testId,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: Readonly<{
  headingId: string;
  /** Текст или ссылка фокуса этапа. */
  title: ReactNode;
  /** Сколько карточек в колонке. null — числа нет (нет чтения). */
  count: number | null;
  marker?: ReactNode;
  headerAction?: ReactNode;
  emptyText: string;
  className?: string;
  /** Сюда можно бросить карточку: нейтральная пунктирная подсветка. */
  highlighted?: boolean;
  testId?: string;
  onDragOver?: DragEventHandler<HTMLElement>;
  onDragLeave?: DragEventHandler<HTMLElement>;
  onDrop?: DragEventHandler<HTMLElement>;
  children: ReactNode;
}>) {
  const empty = count === 0;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "min-h-0 min-w-0 flex-col rounded-card",
        highlighted && "bg-surface-2 outline-2 -outline-offset-2 outline-dashed outline-control-edge",
        className ?? "flex",
      )}
    >
      <header className="flex min-h-11 shrink-0 items-center gap-1.5 border-b border-border px-1.5">
        <h2 id={headingId} className="t-item flex min-w-0 flex-1 items-center text-fg">
          {title}
        </h2>
        {marker}
        {count !== null ? <span className="t-meta shrink-0 tabular-nums text-fg-3">{count}</span> : null}
        {headerAction}
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-0.5 pb-2 pt-2">
        {children}
        {empty ? <li className="t-meta px-1.5 py-1 text-fg-3">{emptyText}</li> : null}
      </ul>
    </section>
  );
}

/** Свёрнутая колонка: название вертикально и число; нажатие раскрывает этап. */
export function BoardRail({
  title,
  count,
  href,
  className,
  testId,
}: Readonly<{
  title: string;
  count: number | null;
  href: string;
  className?: string;
  testId?: string;
}>) {
  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      data-testid={testId}
      title={`Раскрыть этап «${title}»`}
      className={cn(
        "min-h-0 w-11 flex-col items-center gap-2 rounded-nav border-s border-border py-3 text-fg-2 hover:bg-surface-2 hover:text-fg",
        className ?? "flex",
      )}
    >
      <span className="t-item whitespace-nowrap [writing-mode:vertical-rl]">{title}</span>
      {count !== null ? <span className="t-meta tabular-nums text-fg-3">{count}</span> : null}
    </Link>
  );
}

export type BoardSegment = Readonly<{
  key: string;
  title: string;
  /** null — существующее чтение числа не даёт, число не выдумываем. */
  count: number | null;
  href: string;
  active: boolean;
}>;

/** Сегменты-ссылки с числами: «Срок» на продажах, разделы на поступлении. */
export function BoardSegments({
  label,
  showLabel = false,
  items,
}: Readonly<{
  label: string;
  showLabel?: boolean;
  items: readonly BoardSegment[];
}>) {
  return (
    <nav aria-label={label} className="flex min-w-0 items-center gap-2">
      {showLabel ? <span aria-hidden="true" className="t-label shrink-0 text-fg-3">{label}</span> : null}
      <ul className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-ctl border border-border bg-surface p-0.5">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              prefetch={false}
              aria-current={item.active ? "page" : undefined}
              className="v3-choice inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-nav px-2.5 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg"
            >
              {item.title}
              {item.count !== null ? <span className="tabular-nums text-fg-3">{item.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** «Сбросить» — видна, только когда что-то выбрано. */
export function BoardReset({ href }: Readonly<{ href: string }>) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex min-h-11 shrink-0 items-center px-1 text-sm text-fg-2 underline underline-offset-4 hover:text-fg"
    >
      Сбросить
    </Link>
  );
}

/** Строка поиска доски: растягивается, Enter отправляет. */
export function BoardSearch({
  action,
  name = "q",
  defaultValue,
  placeholder,
  maxLength,
  hidden,
}: Readonly<{
  action: string;
  name?: string;
  defaultValue: string;
  placeholder: string;
  maxLength: number;
  /** Остальные выбранные фильтры, чтобы новый поиск их не сбрасывал. */
  hidden: ReactNode;
}>) {
  return (
    <form method="get" action={action} role="search" className="flex min-w-48 flex-1 items-center gap-2 @2xl:max-w-[30rem]">
      {hidden}
      <label className="relative flex min-w-0 flex-1 items-center">
        <span className="sr-only">Поиск</span>
        <Icon name="search" size={18} className="pointer-events-none absolute start-3 text-fg-3" />
        <input
          type="search"
          name={name}
          defaultValue={defaultValue}
          maxLength={maxLength}
          placeholder={placeholder}
          className="min-h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface pe-2.5 ps-9 text-sm text-fg placeholder:text-fg-3"
        />
      </label>
      {/* На desktop Enter отправляет поиск, кнопка нужна только телефону. */}
      <button
        type="submit"
        className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg @2xl:hidden"
      >
        Найти
      </button>
    </form>
  );
}
