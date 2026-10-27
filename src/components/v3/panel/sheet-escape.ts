import { modalOpen, typingTarget } from "../queue/useQueueKeyboard";
import { QUEUE_PASSIVE_POPOVER } from "../queue/queue-navigation";
import { sidePanelEscape } from "./side-panel";

/** Что делает Esc у панели-листа поверх списка: окно или всплывающее окно поверх — их закрыть, поле — выйти из поля, иначе — закрыть панель. */
export type SheetEscapeStep = "modal" | "popover" | "leave-field" | "close";

/**
 * Те же правила, что у боковой панели рядом со списком (`sidePanelEscape`, `SidePanel`): поверх панели открыто модальное окно
 * («Завершить дело», «Новая задача») или всплывающее окно — Esc закрывает его, а не панель; человек печатает в поле панели —
 * первая Esc только выводит из поля (введённое остаётся), вторая закрывает панель. Чистая функция — её проверяет unit-тест.
 */
export function sheetEscapeStep(state: Readonly<{ modal: boolean; popover: boolean; typing: boolean; inSheet: boolean }>): SheetEscapeStep {
  if (state.modal) return "modal";
  if (state.popover) return "popover";
  return sidePanelEscape(state.typing, state.inSheet) === "leave-field" ? "leave-field" : "close";
}

/** Открытые всплывающие окна страницы, в которых человек работает (строка «Отменить» — не такое окно: `QUEUE_PASSIVE_POPOVER`). */
function blockingPopovers(): HTMLElement[] {
  try { return [...document.querySelectorAll<HTMLElement>(":popover-open")].filter((element) => !element.hasAttribute(QUEUE_PASSIVE_POPOVER)); } catch { return []; }
}

/**
 * `onEscapeKeyDown` для `DetailSheet` страниц, где в панели есть поля, окна подтверждения или меню (дело, куратор, документ программы).
 * Radix слушает Esc на документе раньше страницы и закрывает панель при любом фокусе; кроме того, отменённая Esc не доходит до
 * самого браузера — родное окно `<dialog>` и всплывающее окно сами бы её не получили. Поэтому закрытие окна поверх панели делается
 * здесь явно: окно получает свой `cancel`, как от настоящей Esc (его `onCancel` решает, закрыться ли).
 */
export function sheetEscape(event: KeyboardEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const sheet = target?.closest("[data-slot=sheet-content]") ?? null;
  const popovers = blockingPopovers();
  const step = sheetEscapeStep({ modal: modalOpen(), popover: popovers.length > 0, typing: typingTarget(event.target), inSheet: sheet !== null });
  if (step === "close") return;
  event.preventDefault();
  if (step === "leave-field") {
    sheet?.querySelector<HTMLElement>("[data-slot=sheet-title]")?.focus({ preventScroll: true });
  } else if (step === "popover") {
    popovers.at(-1)?.hidePopover();
  } else {
    const dialogs = [...document.querySelectorAll<HTMLDialogElement>("dialog:modal")];
    const dialog = target?.closest<HTMLDialogElement>("dialog:modal") ?? dialogs.at(-1);
    if (dialog?.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
  }
}
