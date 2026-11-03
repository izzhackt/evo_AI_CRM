/**
 * Облик «Базы знаний» (Э8.10, только интерфейс): общие классы окон, меню и
 * строк и короткие даты. Файл без «use client» и без React — его читают и
 * компоненты, и node-тест.
 *
 * Правила DESIGN.md: белый лист на тёплом столе, выбор нейтральный
 * (`.v3-choice`, `aria-current`), один сплошной красный на странице — «Создать»
 * (подтверждения в окнах — тёмные), роли текста `t-*`, цели нажатия 44 px,
 * даты «ДД.ММ» / «ДД.ММ ЧЧ:ММ» по Бишкеку моноширинным шрифтом.
 */
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "../../../lib/platform-organization-time.ts";
import { formatQueueDay } from "../queue/due-bucket.ts";

const TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function moment(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** «20.09» по Бишкеку; другой год — «20.09.25». Нечитаемая дата — null. */
export function knowledgeDay(value: string, now: Date): string | null {
  const date = moment(value);
  return date ? formatQueueDay(dayInOrganizationTimezone(date), dayInOrganizationTimezone(now)) : null;
}

/** «20.09 14:05» по Бишкеку (год — только не текущий). */
export function knowledgeMoment(value: string, now: Date): string | null {
  const date = moment(value);
  return date ? `${knowledgeDay(value, now)} ${TIME.format(date)}` : null;
}

/** Окно в верхнем слое: белый лист, волосяная рамка, тень всплывающего. */
export const KB_DIALOG = "m-auto w-[min(34rem,calc(100vw-2rem))] max-w-none rounded-card border border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/45";
/** Шапка окна: заголовок `t-section` и «Закрыть». */
export const KB_DIALOG_HEAD = "flex items-center justify-between gap-3 border-b border-border p-4";
/** Тело окна прокручивается, шапка стоит. */
export const KB_DIALOG_BODY = "min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4";
/** Меню «Создать ▾» и «⋯» (TopLayerMenu). */
export const KB_MENU = "w-64 max-w-[calc(100vw-2rem)] rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg";
export const KB_MENU_ITEM = "flex min-h-11 w-full items-center gap-2 rounded-nav px-3 text-start t-label text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:text-fg-3 disabled:hover:bg-transparent";
/** Подпись поля над контролом. */
export const KB_LABEL = "grid gap-1 t-label text-fg-2";
/** Поле ввода: 16 px — без увеличения на iPhone. */
export const KB_FIELD = "block h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3";
/** Поле выбора файла: кнопка выбора — 44 px, имя файла сокращается внутри поля. */
export const KB_FILE = "block w-full min-w-0 t-body-compact text-fg-2 file:me-3 file:min-h-11 file:cursor-pointer file:rounded-ctl file:border file:border-control-edge file:bg-surface file:px-3 file:text-fg-2 hover:file:bg-surface-2 disabled:file:cursor-not-allowed";
/** Отметка (флажок, переключатель): нейтральная, зона нажатия — строка 44 px. */
export const KB_CHECK_ROW = "flex min-h-11 cursor-pointer items-center gap-3 t-body-compact text-fg";
export const KB_CHECK = "size-[18px] shrink-0 cursor-pointer accent-fg";
/** Ошибка: что не получилось — красным словом, рядом «Повторить». */
export const KB_ERROR = "flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-border py-2 t-body-compact text-danger";
/** Тихая ссылка-действие 44 px (возврат, «Показать ещё»). */
export const KB_QUIET = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg disabled:cursor-not-allowed disabled:text-fg-3";
