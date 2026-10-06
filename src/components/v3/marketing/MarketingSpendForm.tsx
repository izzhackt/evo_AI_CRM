"use client";
import { useActionState, useState } from "react";
import { btnGhostCls, fieldLabelCls, inputCls } from "@/components/ui";
import type { SpendFormState } from "@/lib/marketing-contract";
import { SPEND_CURRENCIES } from "@/lib/marketing-contract";
import { addMarketingSpendAction } from "@/lib/platform-marketing-actions";

const MESSAGES: Record<SpendFormState["status"], string> = {
  idle: "",
  saved: "Расход записан.",
  invalid: "Проверьте даты (не больше 366 дней), сумму и валюту.",
  forbidden: "Нет права на это действие. Обновите страницу.",
  request_conflict: "Этот запрос уже использован с другими данными. Отправьте форму ещё раз.",
  unavailable: "Результат пока неизвестен. Данные остались в форме; безопасно повторите.",
};

/**
 * Запись расхода за период: сумма, валюта (USD, KGS, EUR — без пересчёта), необязательные кампания и
 * пометка. Тихая кнопка: у страницы нет красного действия. После записи id запроса меняется, повтор
 * при неизвестном результате идёт с прежним.
 */
export function MarketingSpendForm({ requestId, defaultStart, defaultEnd }: Readonly<{ requestId: string; defaultStart: string; defaultEnd: string }>) {
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const [state, action, pending] = useActionState(async (previous: SpendFormState, form: FormData): Promise<SpendFormState> => {
    try {
      const result = await addMarketingSpendAction(previous, form);
      if (result.status === "saved") setCurrentRequestId(crypto.randomUUID());
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId } as SpendFormState);
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden">
        Добавить расход
      </summary>
      <form action={action} className="grid max-w-3xl gap-3 pb-2 sm:grid-cols-2" aria-busy={pending}>
        <input type="hidden" name="request_id" value={currentRequestId} />
        <label><span className={fieldLabelCls}>С какого дня</span><input name="period_start" type="date" required defaultValue={defaultStart} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>По какой день</span><input name="period_end" type="date" required defaultValue={defaultEnd} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>Сумма</span><input name="amount" inputMode="decimal" required maxLength={16} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>Валюта</span>
          <select name="currency" required defaultValue="USD" className={inputCls}>{SPEND_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
        <label><span className={fieldLabelCls}>Кампания, если есть</span><input name="campaign" maxLength={100} className={inputCls} /></label>
        <label><span className={fieldLabelCls}>Пометка</span><input name="note" maxLength={500} className={inputCls} /></label>
        <div className="sm:col-span-2"><button className={btnGhostCls} disabled={pending}>{pending ? "Записываем…" : "Записать расход"}</button></div>
      </form>
      {state.status !== "idle" ? <p role={state.status === "saved" ? "status" : "alert"} className="pb-2 t-body-compact text-fg-2">{MESSAGES[state.status]}</p> : null}
    </details>
  );
}
