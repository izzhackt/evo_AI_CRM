"use client";

import { useEffect, useId, useRef, useState } from "react";

import { KeyList } from "../queue/KeyList";
import { LIST_KEYS, SHELL_KEYS } from "../queue/keyboard-keys";
import { QUEUE_HELP_ID } from "../queue/QueueKeyboardHelp";
import { modalOpen, openPopover, typingTarget } from "../queue/useQueueKeyboard";

let opener: (() => void) | null = null;

/** Открыть окно «?» оболочки (из Ctrl+K — «Все клавиши»). */
export function openKeyboardHelp(): boolean {
  if (!opener) return false;
  opener();
  return true;
}

/**
 * Окно «?» оболочки (Э7): клавиши CRM в окне, а не текстом на странице.
 * На «Задачах» и «Студентах» «?» открывает окно своей очереди (там те же
 * строки и клавиши страницы); здесь — остальные страницы. Окно верхнего
 * слоя, Esc закрывает и возвращает фокус.
 */
export function KeyboardHelpDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => {
      const focused = document.activeElement;
      returnTo.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
      setOpen(true);
    };
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typingTarget(event.target) || openPopover() || modalOpen()) return;
      // У очереди своё окно «?» — его открывает `useQueueKeyboard`.
      if (document.getElementById(QUEUE_HELP_ID)) return;
      event.preventDefault();
      show();
    };
    document.addEventListener("keydown", listener);
    opener = show;
    return () => {
      document.removeEventListener("keydown", listener);
      if (opener === show) opener = null;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
  }, [open]);

  function hide() {
    setOpen(false);
    dialogRef.current?.close();
    const target = returnTo.current;
    if (target?.isConnected) target.focus();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="v3-keyboard-help"
      onCancel={(event) => { event.preventDefault(); hide(); }}
      onClick={(event) => { if (event.target === event.currentTarget) hide(); }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] max-w-none rounded-card border border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/35"
    >
      {open ? <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="t-section">Клавиши</h2>
          <button ref={closeRef} type="button" onClick={hide} className="inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg">
            Закрыть
          </button>
        </div>
        <KeyList keys={SHELL_KEYS} className="mt-3" />
        <h3 className="mt-4 t-item text-fg">В списках</h3>
        <p className="mt-0.5 t-meta text-fg-2">«Задачи», «Студенты», EVO Docs</p>
        <KeyList keys={LIST_KEYS} className="mt-2" />
      </div> : null}
    </dialog>
  );
}
