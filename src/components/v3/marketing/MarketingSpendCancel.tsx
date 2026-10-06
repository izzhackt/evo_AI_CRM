"use client";
import { useActionState, useState } from "react";
import { btnDangerGhostCls, btnGhostCls } from "@/components/ui";
import type { SpendCancelState } from "@/lib/marketing-contract";
import { cancelMarketingSpendAction } from "@/lib/platform-marketing-actions";

const MESSAGES: Record<SpendCancelState["status"], string> = {
  idle: "",
  cancelled: "Отменено.",
  invalid: "Не удалось отменить: запись не распознана.",
  forbidden: "Нет права на это действие.",
  request_conflict: "Запрос уже использован. Обновите страницу.",
  not_found: "Записи уже нет. Обновите страницу.",
  already_cancelled: "Запись уже отменена. Обновите страницу.",
  unavailable: "Результат пока неизвестен. Повторите.",
};

/** «Отменить» с подтверждением: отмена — новая строка-ссылка, исходная запись остаётся в истории. */
export function MarketingSpendCancel({ spendId, requestId }: Readonly<{ spendId: string; requestId: string }>) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(async (previous: SpendCancelState, form: FormData): Promise<SpendCancelState> => {
    try { return await cancelMarketingSpendAction(previous, form); }
    catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId } as SpendCancelState);
  if (state.status === "cancelled") return <p role="status" className="t-meta text-fg-2">{MESSAGES.cancelled}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <form action={action} className="flex flex-wrap items-center gap-2" aria-busy={pending}>
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="spend_id" value={spendId} />
          <span className="t-body-compact text-fg-2">Отменить эту запись?</span>
          <button className={btnDangerGhostCls} disabled={pending}>{pending ? "Отменяем…" : "Да, отменить"}</button>
          <button type="button" className={btnGhostCls} disabled={pending} onClick={() => setConfirming(false)}>Нет</button>
        </form>
      ) : (
        <button type="button" className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg" onClick={() => setConfirming(true)}>Отменить</button>
      )}
      {state.status !== "idle" ? <p role="alert" className="t-meta text-fg-2">{MESSAGES[state.status]}</p> : null}
    </div>
  );
}
