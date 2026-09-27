"use client";

import { useEffect, useId, useRef } from "react";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import type { HandoffAcknowledgement } from "@/lib/platform-handoff-acknowledgement";

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { ProfileHandoffAcknowledgement } from "./ProfileSalesTransition";

/** Решения — нейтральный переключатель: выбранное — рамка текста и серая подложка, не красный. */
const CHOICE = `${QUEUE_SECONDARY} grow aria-pressed:border-fg aria-pressed:bg-surface-2 aria-pressed:text-fg`;

/**
 * «Принять дело» Student 360 (Э4) — главное действие дела, пока оно ждёт
 * ответа этого куратора: кнопка у заголовка открывает выдвижную панель
 * справа (модальный `<dialog>` верхнего слоя: фон недоступен, фокус внутри,
 * Esc закрывает, фокус возвращается на кнопку). В панели — прежняя форма
 * ответа на передачу (`ProfileHandoffAcknowledgement`, то же действие, поля,
 * ключ запроса и ожидаемые id): «Принять дело» выбрано сразу, «Нужно
 * уточнить» и «Отклонить» — рядом.
 *
 * После ответа сервер перечитывает страницу, дело больше не ждёт ответа, и
 * кнопка с панелью уходят; фокус с исчезнувшей кнопки переходит на заголовок
 * «Задач» («Обзор») или на полосу вкладок, а не падает на страницу.
 */
export function CaseAcceptDrawer({ name, snapshot }: Readonly<{
  name: string;
  snapshot: HandoffAcknowledgement & Readonly<{ requestId: string }>;
}>) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const answered = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  useEffect(() => () => {
    if (!answered.current) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      (document.getElementById("case-tasks-title")
        ?? document.querySelector<HTMLElement>('nav[aria-label="Разделы профиля"]'))?.focus();
    });
  }, []);

  const open = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // Поле внутри <dialog> становится фокусируемым только после showModal():
    // фокус — на выбранное решение, с него видно и остальные.
    dialog.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  };
  const close = () => dialogRef.current?.close();

  return <>
    <button ref={triggerRef} type="button" aria-haspopup="dialog" onClick={open} className={btnCls} data-testid="v3-case-primary">
      Принять дело
    </button>
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      data-testid="v3-case-accept-drawer"
      className="fixed inset-y-0 end-0 start-auto m-0 h-dvh max-h-none w-full max-w-[26rem] overflow-y-auto border-0 border-s border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/45"
    >
      <div className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-border bg-surface ps-4 pe-2">
        <h2 id={headingId} className="t-section min-w-0 flex-1 truncate text-fg" title={name}>Приём дела · {name}</h2>
        <button type="button" onClick={close} aria-label="Закрыть"
          className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg">
          <Icon name="x" size={20} />
        </button>
      </div>
      <div className="p-4">
        <ProfileHandoffAcknowledgement
          snapshot={snapshot}
          drawer={{ onCancel: close, choiceClassName: CHOICE, confirmClassName: QUEUE_CONFIRM, cancelClassName: QUEUE_SECONDARY }}
          onSaved={() => {
            answered.current = true;
            close();
          }}
        />
      </div>
    </dialog>
  </>;
}
