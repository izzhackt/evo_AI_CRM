"use client";
import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import { saveFinanceEntryAction } from "@/lib/platform-finance-entry-actions";
import { financeMoney, type FinanceEntryState, type FinanceEntryWorkspace } from "@/lib/platform-finance-entry-contract";

type Props = Readonly<{ workspace: FinanceEntryWorkspace; operation: "obligation" | "payment" | "refund"; requestId: string }>;
export function FinanceEntryForm(props: Props) {
  const [requestId, setRequestId] = useState(props.requestId);
  return <FinanceEntryEditor key={requestId} {...props} requestId={requestId} onAnother={() => setRequestId(crypto.randomUUID())} />;
}
function FinanceEntryEditor({ workspace, operation, requestId, onAnother }: Props & { onAnother: () => void }) {
  const router = useRouter();
  const frozen = useRef<FormData | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const [obligationId, setObligationId] = useState(workspace.obligations[0]?.id ?? "");
  const [state, action, pending] = useActionState(async (previous: FinanceEntryState, form: FormData): Promise<FinanceEntryState> => {
    const submitted = frozen.current ?? form; frozen.current = submitted;
    try {
      const result = await saveFinanceEntryAction(previous, submitted);
      if (result.status !== "unavailable") frozen.current = null;
      if (result.status === "saved") router.refresh();
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId, resourceId: null } as FinanceEntryState);
  const locked = pending || ["saved", "unavailable"].includes(state.status)
    || (state.status === "request_conflict" && currentRequestId === state.requestId);
  const obligation = workspace.obligations.find(item => item.id === obligationId);
  const title = operation === "obligation" ? "Добавить обязательство" : operation === "payment" ? "Записать оплату" : "Записать возврат";
  const messages: Record<FinanceEntryState["status"], string> = { idle: "", saved: "Операция сохранена в финансовой истории.", invalid: "Проверьте поля, валюту и доступную сумму. Возврат не может превышать исходную оплату.", forbidden: "Нет действующего права на эту операцию. Проверьте доступ с Admin.", request_conflict: "Этот запрос уже использован. Проверьте историю перед новой операцией.", unavailable: "Результат неизвестен. Ввод сохранён; повторите тот же запрос, не создавая второй платёж." };
  return <details className="border-t border-border py-3">
    <summary className="min-h-11 cursor-pointer py-3 font-medium text-accent-text">{title}</summary>
    <form action={action} className="mt-3 space-y-4" aria-busy={pending}>
      <input type="hidden" name="request_id" value={currentRequestId} /><input type="hidden" name="case_id" value={workspace.caseId} /><input type="hidden" name="operation" value={operation} />
      <fieldset disabled={locked} className="space-y-4">
        {operation === "obligation" ? <>
          <input type="hidden" name="obligation_id" value="" /><input type="hidden" name="payment_id" value="" /><input type="hidden" name="source" value="" /><input type="hidden" name="evidence" value="" />
          <label className="block"><span className={labelCls}>Назначение</span><input name="label" required maxLength={500} className={inputCls} /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label><span className={labelCls}>Тип</span><select name="category" className={inputCls}><option value="evo_service_fee">Услуги EVO</option><option value="third_party_cost">Расходы третьих сторон</option></select></label>
            <label><span className={labelCls}>Валюта</span><input name="currency" required pattern="[A-Za-z]{3}" maxLength={3} placeholder="USD" className={inputCls} /></label></div>
          <label className="block"><span className={labelCls}>Следующий шаг по оплате</span><input name="next_action" required maxLength={1000} className={inputCls} /></label>
        </> : <>
          <input type="hidden" name="label" value="" /><input type="hidden" name="category" value="" /><input type="hidden" name="next_action" value="" />
          <input type="hidden" name="currency" value={obligation?.currency ?? ""} />
          <label className="block"><span className={labelCls}>Обязательство</span><select name="obligation_id" required value={obligationId} onChange={event => setObligationId(event.target.value)} className={inputCls}>
            {workspace.obligations.map(item => <option key={item.id} value={item.id}>{item.label} · {item.currency}</option>)}</select></label>
          {obligation ? <p className="text-sm text-fg-2">Осталось по обязательству: {financeMoney(obligation.outstandingMinor, obligation.currency)}</p> : null}
          {operation === "refund" ? <label className="block"><span className={labelCls}>Какая оплата возвращается</span><select key={obligationId} name="payment_id" required className={inputCls} defaultValue=""><option value="" disabled>Выберите исходную оплату</option>
            {workspace.events.filter(event => event.type === "payment" && event.obligationId === obligationId && BigInt(event.refundableMinor) > BigInt(0)).map(event => <option key={event.id} value={event.id}>{new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek" }).format(new Date(event.occurredAt))} · доступно {financeMoney(event.refundableMinor, event.currency)}</option>)}</select></label>
            : <input type="hidden" name="payment_id" value="" />}
          <div className="grid gap-4 sm:grid-cols-2"><label><span className={labelCls}>Способ / источник оплаты</span><input name="source" required maxLength={200} className={inputCls} /></label>
            <label><span className={labelCls}>Ссылка или номер подтверждения</span><input name="evidence" required maxLength={512} className={inputCls} /></label></div>
        </>}
        <div className="grid gap-4 sm:grid-cols-2"><label><span className={labelCls}>Сумма{operation !== "obligation" && obligation ? ` (${obligation.currency})` : ""}</span><input name="amount" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" required className={inputCls} /></label>
          <label><span className={labelCls}>{operation === "obligation" ? "Срок оплаты" : "Когда получено / возвращено"} · Бишкек</span><input name="at" type="datetime-local" required className={inputCls} /></label></div>
        <label className="block"><span className={labelCls}>Основание</span><input name="reason" required maxLength={1000} className={inputCls} /></label>
        <p className="text-xs leading-relaxed text-fg-2">Записывайте только подтверждённый факт. Эта форма не переводит деньги и не списывает их со счёта.</p>
        <button className={btnCls} disabled={locked}>{pending ? "Сохраняем…" : title}</button>
      </fieldset>
      {state.status !== "idle" ? <p role={state.status === "saved" ? "status" : "alert"} className="text-sm text-fg-2">{messages[state.status]}</p> : null}
      {state.status === "unavailable" ? <button type="submit" disabled={pending} className={btnCls}>Повторить тот же запрос</button> : null}
      {state.status === "saved" ? <button type="button" onClick={onAnother} className="min-h-11 text-sm underline">Новая операция</button> : null}
      {state.status === "request_conflict" ? <div className="flex flex-wrap gap-3"><button type="button" onClick={() => router.refresh()} className="min-h-11 text-sm underline">Обновить историю</button>
        {currentRequestId === state.requestId ? <button type="button" onClick={() => setCurrentRequestId(crypto.randomUUID())} className="min-h-11 text-sm underline">Сверил историю, продолжить с моим вводом</button> : null}</div> : null}
    </form>
  </details>;
}
