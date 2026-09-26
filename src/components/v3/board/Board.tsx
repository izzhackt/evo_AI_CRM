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
  BOARD_PANEL_FOLD_BELOW_PX,
  BOARD_RAIL_TRACK,
  boardTracks,
  cappedBoardTracks,
} from "@/components/v3/board/board-tracks";

/**
 * Открытая панель лида стоит в ряд с доской. Пока контейнер уже
 * `BOARD_PANEL_FOLD_BELOW_PX` (1556 px ≤ 97.5rem), колонки, кроме этапа
 * лида, сворачиваются в рейки: панель не закрывает карточку, по которой
 * нажали. Этап лида, который без панели стоит рейкой («Переданы»), в это
 * время раскрывается колонкой. Решает запрос контейнера CSS, поэтому
 * серверная разметка с `?lead=` не мигает. Классы записаны целиком — их
 * находит сборщик Tailwind.
 */
export const BOARD_PANEL_FOLD = {
  /** Дорожки доски, пока панель открыта и места мало. */
  tracks: "@6xl:@max-[97.5rem]:[grid-template-columns:var(--board-tracks-panel)]",
  /** Заголовок и карточки свёрнутой колонки. */
  content: "@6xl:@max-[97.5rem]:hidden",
  /** Рейка свёрнутой колонки. */
  rail: "hidden @6xl:@max-[97.5rem]:flex",
  /** Рейка этапа лида, который раскрывается рядом с панелью: только пока места хватает. */
  wideRail: "hidden @min-[97.5rem]:flex",
  /** Раскрытая колонка того же этапа: только пока панель открыта и места мало. */
  column: "hidden @6xl:@max-[97.5rem]:flex",
} as const;

/** «Айгүл Осмонова» → «АО»; полное имя остаётся в подсказке `title`. */
export function ownerInitials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => (Array.from(part)[0] ?? "").toLocaleUpperCase("ru-RU"))
    .join("");
}

/** Оболочка карточки: одна рамка, наведение — край контрола; в новом облике — волосяная тень (`.v3-raised`). */
export const BOARD_CARD_CLASS =
  "v3-raised group relative min-w-0 rounded-ctl border border-border bg-surface px-3 py-2 hover:border-control-edge focus-within:border-control-edge";

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
  spread = false,
  fold,
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
  /**
   * Колонка одна на всю ширину (фокус этапа, этап лида рядом с панелью):
   * карточки встают сеткой по 240 px и больше, а не растягиваются на 1000 px
   * от имени до срока. Уже 240 px — одна карточка во всю колонку.
   */
  spread?: boolean;
  /** Рядом открыта панель и места мало: колонка сворачивается в рейку. */
  fold?: Readonly<{ title: string; href: string }>;
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
      <header className={cn("flex min-h-11 shrink-0 items-center gap-1.5 border-b border-border px-1.5", fold && BOARD_PANEL_FOLD.content)}>
        <h2 id={headingId} className="t-item flex min-w-0 flex-1 items-center text-fg">
          {title}
        </h2>
        {marker}
        {count !== null ? <span className="t-meta shrink-0 tabular-nums text-fg-3">{count}</span> : null}
        {headerAction}
      </header>
      <ul
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-0.5 pb-2 pt-2",
          spread && "@6xl:grid @6xl:grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] @6xl:content-start",
          fold && BOARD_PANEL_FOLD.content,
        )}
      >
        {children}
        {empty ? <li className="t-meta col-span-full px-1.5 py-1 text-fg-3">{emptyText}</li> : null}
      </ul>
      {fold ? <BoardRail title={fold.title} count={count} href={fold.href} className={cn(BOARD_PANEL_FOLD.rail, "flex-1")} /> : null}
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
  stage,
}: Readonly<{
  title: string;
  count: number | null;
  href: string;
  className?: string;
  testId?: string;
  /** Ключ этапа: сюда возвращается фокус, когда карточки этапа не видно. */
  stage?: string;
}>) {
  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      data-testid={testId}
      data-stage-rail={stage}
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
