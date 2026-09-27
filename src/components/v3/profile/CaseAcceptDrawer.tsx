"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import type { HandoffAcknowledgement } from "@/lib/platform-handoff-acknowledgement";

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { HandoffResponseSummary, ProfileHandoffAcknowledgement } from "./ProfileSalesTransition";

/**
 * Контекст решения в панели (review Э4, 27.09) — только уже прочитанное
 * страницей: кто и когда передал, направление, шаг дела, продажа (только тому,
 * кому её отдаёт чтение продаж) и текущий ответ. Новых чтений нет.
 */
export type CaseAcceptContext = Readonly<{
  handedOffBy: Readonly<{ name: string; at: string; label: string }> | null;
  direction: string | null;
  step: string | null;
  sale: Readonly<{ manager: string | null; nextAction: string | null }> | null;
}>;

function Fact({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="min-w-0 border-b border-border py-2.5 last:border-b-0">
      <dt className="t-caption text-fg-2">{term}</dt>
      <dd className="mt-0.5 min-w-0 break-words t-body-compact text-fg">{children}</dd>
    </div>
  );
}

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
 * После ответа сервер перечитывает страницу:
 * - «Принять дело» — дело больше не ждёт ответа, панель закрывается;
 * - «Отклонить» — команда 182/249 снимает куратора и возвращает дело в
 *   ожидание куратора; чтение 130 больше не отдаёт ни назначения, ни ответа
 *   (`assignmentEventId` и `current` — null, `canRespond` — false), и кнопка
 *   уходит вместе с открытой панелью;
 * - «Нужно уточнить» — дело в работе у того же куратора и всё ещё ждёт
 *   приёма: панель остаётся открытой — «Ответ сохранён.», «Уже сохранено» и
 *   новый «Текущий ответ» из перечитанного снимка; закрывают её Esc,
 *   «Отмена» или ×.
 * Когда после записанного ответа (приём или отказ) кнопка уходит со страницы,
 * фокус переходит на заголовок «Задач» («Обзор») или на полосу вкладок, а не
 * падает на страницу.
 */
export function CaseAcceptDrawer({ name, snapshot, context }: Readonly<{
  name: string;
  snapshot: HandoffAcknowledgement & Readonly<{ requestId: string }>;
  context: CaseAcceptContext;
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
      <div className="space-y-4 p-4">
        {/* Решение не вслепую: передача, направление, шаг, продажа и текущий ответ — над выбором. */}
        <dl className="border-b border-border" data-testid="v3-case-accept-context">
          {context.handedOffBy ? (
            <Fact term="Передал">
              {context.handedOffBy.name}
              <span className="text-fg-2"> · <time dateTime={context.handedOffBy.at} className="font-mono tabular-nums">{context.handedOffBy.label}</time></span>
            </Fact>
          ) : null}
          {context.direction ? <Fact term="Направление">{context.direction}</Fact> : null}
          {context.step ? <Fact term="Что дальше">{context.step}</Fact> : null}
          {context.sale ? (
            <Fact term="Продажа">
              <span className="block">{context.sale.manager ?? "Менеджер не назначен"}</span>
              {context.sale.nextAction ? <span className="block text-fg-2">{context.sale.nextAction}</span> : null}
            </Fact>
          ) : null}
          <Fact term="Текущий ответ"><HandoffResponseSummary current={snapshot.current} /></Fact>
        </dl>
        <ProfileHandoffAcknowledgement
          snapshot={snapshot}
          drawer={{ onCancel: close, choiceClassName: CHOICE, confirmClassName: QUEUE_CONFIRM, cancelClassName: QUEUE_SECONDARY }}
          onSaved={(decision) => {
            // Любой записанный ответ может убрать кнопку («Отклонить» снимает назначение):
            // фокус переносит очистка эффекта выше («Задачи» или вкладки). Закрывает панель только приём.
            answered.current = true;
            if (decision === "accepted") close();
          }}
        />
      </div>
    </dialog>
  </>;
}
