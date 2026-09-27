/**
 * Одна боковая панель записи на всех рабочих экранах (Э7 плана редизайна
 * 25.09.2026, PLAN_CHANGES 27.09). Чистые значения без React: их берут и
 * серверные страницы («Отчёт продаж», «Нагрузка кураторов»), и тесты.
 *
 * Поведение одно у «Задач», «Быстрого просмотра» «Студентов», «Нагрузки
 * кураторов», «Заявок», «Отчёта продаж» и панели лида «Воронки продаж»:
 * от 1280 px окна (`xl`, 80rem) панель — вторая колонка рядом со списком,
 * уже — лист в верхнем слое (`SidePanel`). От 768 px (`md`) у панели
 * закреплённая шапка с крестиком в углу, тело прокручивается под ней; на
 * телефоне — лист во весь экран с полосой «← К …».
 */

/**
 * Ширина панели — один токен для сетки, листа и доски:
 * `--side-panel-width` в `v3.css`. 26rem = 416 px.
 */
export const SIDE_PANEL_WIDTH_REM = 26;

/**
 * От этой ширины окна панель сдвигает список, уже — лежит поверх. Та же
 * граница, что `xl:` у классов панели (80rem): запрос в rem совпадает с CSS
 * и при крупном шрифте браузера по умолчанию.
 */
export const SIDE_PANEL_WIDE_QUERY = "(min-width: 80rem)";

/**
 * Сетка «список | панель» страницы с открытой записью. Ширина второй колонки
 * — токен панели. Классы записаны целиком — их находит сборщик Tailwind.
 */
export const SIDE_PANEL_SPLIT = "xl:grid xl:grid-cols-[minmax(0,1fr)_var(--side-panel-width)] xl:items-start xl:gap-6";

/** Сетка страницы: с открытой записью — «список | панель», без неё — как была. */
export function sidePanelSplit(open: boolean, base?: string): string | undefined {
  if (!open) return base;
  return base ? `${base} ${SIDE_PANEL_SPLIT}` : SIDE_PANEL_SPLIT;
}

/**
 * Куда вернуть фокус после закрытия панели строки очереди: ссылка «Открыть»
 * этой строки (`data-queue-row` и `data-queue-open`, `useQueueKeyboard`).
 */
export function queueRowReturn(key: string): string {
  return `[data-queue-row="${cssString(key)}"] [data-queue-open]`;
}

/** Значение для селектора атрибута в кавычках: `"` и `\` экранируются. */
function cssString(value: string): string {
  return value.replace(/["\\]/gu, (char) => `\\${char}`);
}

/** Возврат фокуса по значению атрибута (`[data-lead-link="…"]` и т. п.). */
export function attributeReturn(attribute: string, value: string, inner = ""): string {
  return `[${attribute}="${cssString(value)}"]${inner ? ` ${inner}` : ""}`;
}

/** То, что нужно от элемента-кандидата возврата фокуса (и заглушке в тесте). */
type ReturnCandidate = Readonly<{
  isConnected: boolean;
  getClientRects(): ArrayLike<unknown>;
  closest(selector: string): unknown;
  focus(): void;
}>;

/**
 * Первый подключённый и видимый элемент по селекторам возврата: строка
 * списка, карточка доски, иначе запасной вариант (рейка этапа). Элемент
 * внутри диалога (сама панель, окно поверх) не подходит; неверный селектор
 * пропускается.
 */
export function sidePanelReturnTarget<T extends ReturnCandidate>(
  scope: Readonly<{ querySelectorAll(selector: string): Iterable<T> | ArrayLike<T> }>,
  selectors: string | readonly string[] | undefined,
): T | null {
  for (const selector of typeof selectors === "string" ? [selectors] : selectors ?? []) {
    let found: T[] = [];
    try { found = Array.from(scope.querySelectorAll(selector)); } catch { continue; }
    const shown = found.find((element) => element.isConnected && element.getClientRects().length > 0 && !element.closest("dialog"));
    if (shown) return shown;
  }
  return null;
}

/**
 * Что делает Esc у открытой панели — одно правило на любой ширине окна
 * (рядом со списком — `keydown`, на листе — `cancel` диалога). Человек
 * печатает в поле панели: первая Esc только выводит из поля (фокус встаёт
 * на заголовок записи, введённое остаётся), вторая закрывает. Поле вне
 * панели (поиск списка) — не её дело. Иначе — закрыть.
 */
export function sidePanelEscape(typing: boolean, inPanel: boolean): "leave-field" | "close" | "ignore" {
  if (!typing) return "close";
  return inPanel ? "leave-field" : "ignore";
}

/**
 * Возвращать ли фокус на строку, когда панель ушла: только если фокус
 * остался без места (ушёл вместе с панелью на `body` или элемент отключён).
 * Если человек уже перевёл его сам — на другую строку, в меню, в поле, —
 * его не трогаем.
 */
export function sidePanelFocusReturn(
  active: Readonly<{ isConnected: boolean }> | null,
  body: unknown,
): boolean {
  return active === null || active === body || !active.isConnected;
}
