"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { Icon } from "@/components/icons";

import styles from "./CalendarPanel.module.css";

const DESKTOP = "(min-width: 64rem)";
function subscribeWidth(notify: () => void) {
  const media = window.matchMedia(DESKTOP);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
function desktopSnapshot() { return window.matchMedia(DESKTOP).matches; }
function serverSnapshot() { return false; }

function canFocus(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected &&
    element.getClientRects().length > 0 && !element.closest("[hidden], [inert]") &&
    !element.matches(":disabled");
}

/** One DOM subtree: changing dialog mode must not reset a form or navigate. */
export function CalendarPanel({
  id, open, contentKey, title, create, navigationPending, onRequestClose, returnFocus, children,
}: Readonly<{
  id: string;
  open: boolean;
  contentKey: string;
  title: string;
  create: boolean;
  navigationPending: boolean;
  onRequestClose: () => void;
  returnFocus: () => HTMLElement | null;
  children: ReactNode;
}>) {
  const desktop = useSyncExternalStore(subscribeWidth, desktopSnapshot, serverSnapshot);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const applied = useRef({ open: false, desktop, contentKey });
  const restoreAfterClose = useRef(false);
  const pickerEscapeHeld = useRef(false);
  const titleId = `${id}-title`;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = applied.current;
    if (previous.open !== open || previous.desktop !== desktop || previous.contentKey !== contentKey) {
      pickerEscapeHeld.current = false;
    }
    const focused = document.activeElement;
    const retainFocus = previous.open && previous.desktop !== desktop &&
      dialog.contains(focused) && canFocus(focused) ? focused : null;
    const selection = retainFocus instanceof HTMLInputElement || retainFocus instanceof HTMLTextAreaElement
      ? { start: retainFocus.selectionStart, end: retainFocus.selectionEnd, direction: retainFocus.selectionDirection }
      : null;

    if (!open) {
      if (dialog.open) dialog.close();
      if (previous.open) restoreAfterClose.current = true;
      if (restoreAfterClose.current && !navigationPending) {
        const target = returnFocus();
        if (canFocus(target)) target.focus({ preventScroll: true });
        restoreAfterClose.current = false;
      }
    } else {
      restoreAfterClose.current = false;
      if (dialog.open && previous.desktop !== desktop) dialog.close();
      const opening = !dialog.open;
      if (!dialog.open) {
        if (desktop) dialog.show();
        else dialog.showModal();
      }
      if (canFocus(retainFocus)) {
        retainFocus.focus({ preventScroll: true });
        if (selection && selection.start !== null && selection.end !== null &&
          (retainFocus instanceof HTMLInputElement || retainFocus instanceof HTMLTextAreaElement)) {
          retainFocus.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
        }
      } else if (opening || !previous.open || previous.contentKey !== contentKey || previous.desktop !== desktop) {
        const input = create ? dialog.querySelector<HTMLInputElement>("[data-calendar-create-title]") : null;
        (canFocus(input) ? input : headingRef.current)?.focus({ preventScroll: true });
      }
    }
    applied.current = { open, desktop, contentKey };
  }, [open, desktop, contentKey, create, navigationPending, returnFocus]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      pickerEscapeHeld.current = false;
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog ref={dialogRef} id={id} className={styles.dialog} aria-labelledby={titleId}
      onKeyDownCapture={(event) => {
        const continuingPress = event.key === "Escape" && event.repeat && pickerEscapeHeld.current;
        pickerEscapeHeld.current = false;
        if (continuingPress) {
          pickerEscapeHeld.current = true;
          event.preventDefault();
          return;
        }
        const select = event.target;
        if (event.key === "Escape" && select instanceof HTMLSelectElement &&
          document.activeElement === select && CSS.supports("selector(:open)") && select.matches(":open")) {
          // Dismiss the native popup without forwarding this Escape to the panel.
          pickerEscapeHeld.current = true;
          event.preventDefault();
          select.blur();
          if (canFocus(select)) select.focus({ preventScroll: true });
        }
      }}
      onKeyUpCapture={() => { pickerEscapeHeld.current = false; }}
      onPointerDownCapture={() => { pickerEscapeHeld.current = false; }}
      onCancel={(event) => { event.preventDefault(); onRequestClose(); }}
      onKeyDown={(event) => {
        if (desktop && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onRequestClose();
        }
      }}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-2">
        <h2 ref={headingRef} id={titleId} tabIndex={-1} className="min-w-0 self-center break-words text-sm font-semibold text-fg">
          {title}
        </h2>
        <button type="button" onClick={onRequestClose}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg">
          <span className="sr-only">Закрыть панель задачи</span>
          <Icon name="x" size={16} />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4">{children}</div>
    </dialog>
  );
}
