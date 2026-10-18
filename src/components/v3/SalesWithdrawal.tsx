"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { btnGhostCls, inputCls } from "@/components/ui";
import { setSalesRegisterWithdrawalAction } from "@/lib/platform-sales-register-actions";
import { SALES_WITHDRAWAL_KINDS } from "@/lib/platform-sales-register-contract";
import type { SalesWithdrawalActionState } from "@/lib/sales-withdrawal-contract";
import { salesWithdrawalChoice, salesWithdrawalMessage } from "@/lib/v3/wording";
import { useAnchoredPopover } from "./queue/useAnchoredPopover";

/**
 * «Убрать» / «Вернуть» (слова владельца 18.10, миграция 307). Действие — кнопка, не ссылка.
 * «Убрать» открывает маленькое окно (popover, не модальное): «Оплатил частично» / «Не оплатил»,
 * заметка до 500 символов и «Убрать»; без выбора записать нельзя. Убранная запись остаётся в
 * отчёте с чипом, а «Вернуть» — настоящая обратная команда, одно нажатие без вопросов.
 * Стоит в строке таблицы (полная ширина и телефон) и в правой панели открытой записи; в каждый
 * момент у записи одно такое место. Права проверяет сервер: кнопку получает тот, у кого они есть.
 */

const ACTION = "inline-flex min-h-11 items-center rounded-nav px-2 t-label text-fg-2 underline underline-offset-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
const CHOICE = "flex min-h-11 items-center gap-2 rounded-nav px-1 t-body-compact text-fg";

export function SalesWithdrawalControl({ record, name, withdrawn, requestId, align = "end" }: Readonly<{
  record: Readonly<{ id: string; version: number }>;
  /** Имя в записи: делает имя кнопки уникальным среди кнопок строк. */
  name: string;
  /** Запись уже убрана: вместо «Убрать» — «Вернуть». */
  withdrawn: boolean;
  requestId: string;
  align?: "start" | "end";
}>) {
  const router = useRouter();
  const menu = useAnchoredPopover(align);
  const [state, dispatch, pending] = useActionState<SalesWithdrawalActionState, FormData>(setSalesRegisterWithdrawalAction, {
    status: "idle", requestId, recordId: record.id,
  });
  useEffect(() => {
    if (state.status !== "saved") return;
    document.getElementById(menu.popoverId)?.hidePopover?.();
    router.refresh();
  }, [state.status, menu.popoverId, router]);
  const message = state.status !== "idle" && state.status !== "saved" ? salesWithdrawalMessage(state.status) : null;
  const identity = (restore: boolean) => <>
    <input type="hidden" name="request_id" value={state.requestId} />
    <input type="hidden" name="record_id" value={record.id} />
    <input type="hidden" name="expected_version" value={record.version} />
    {restore ? <><input type="hidden" name="kind" value="" /><input type="hidden" name="note" value="" /></> : null}
  </>;
  const label = name.trim() || "запись без имени";

  if (withdrawn) {
    return (
      <form action={dispatch} className="relative z-10 flex flex-col items-end" data-testid="sales-withdrawal-return">
        {identity(true)}
        <button type="submit" disabled={pending} aria-label={`Вернуть в продажи: ${label}`} className={ACTION}>
          {pending ? "Возвращаем…" : "Вернуть"}
        </button>
        {message ? <p role="alert" className="max-w-56 text-end t-meta text-fg-2">{message}</p> : null}
      </form>
    );
  }
  return (
    <div className="relative z-10" data-testid="sales-withdrawal-remove">
      <button id={menu.triggerId} type="button" popoverTarget={menu.popoverId} style={menu.triggerStyle}
        aria-label={`Убрать из продаж: ${label}`} className={ACTION}>
        Убрать
      </button>
      <div id={menu.popoverId} popover="auto" style={menu.popoverStyle} role="dialog" aria-label={`Убрать из продаж: ${label}`}
        className={`v3-anchored ${align === "end" ? "v3-anchored-end " : ""}w-72 max-w-[calc(100vw-1rem)] rounded-ctl border border-border bg-surface p-3 text-fg shadow-evo-lg`}>
        <form action={dispatch} className="space-y-3">
          {identity(false)}
          <fieldset className="space-y-0.5">
            <legend className="mb-1 t-item text-fg">Убрать из продаж</legend>
            {SALES_WITHDRAWAL_KINDS.map((kind, index) => (
              <label key={kind} className={CHOICE}>
                <input type="radio" name="kind" value={kind} required autoFocus={index === 0} className="size-5 accent-accent" />
                <span>{salesWithdrawalChoice(kind)}</span>
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="mb-1 block t-meta text-fg-2">Заметка</span>
            <input type="text" name="note" maxLength={500} autoComplete="off" className={inputCls} />
          </label>
          {message ? <p role="alert" className="t-meta text-fg-2">{message}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className={btnGhostCls}>{pending ? "Убираем…" : "Убрать"}</button>
            <button type="button" popoverTarget={menu.popoverId} popoverTargetAction="hide" className={`${ACTION} px-3`}>Отмена</button>
          </div>
        </form>
      </div>
    </div>
  );
}
