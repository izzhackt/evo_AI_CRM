"use client";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { btnCls, inputCls, labelCls } from "@/components/ui";
import { createManualLeadAction } from "@/lib/platform-manual-lead-actions";
import { LEAD_DIRECTIONS, MANUAL_LEAD_SOURCES, type ManualLeadState } from "@/lib/platform-manual-lead-contract";

export function ManualLeadForm(props: Readonly<{ requestId: string; ownerId: string; owners: readonly Readonly<{ id: string; displayName: string }>[] }>) {
  const [requestId, setRequestId] = useState(props.requestId);
  return <details className="mt-5 rounded-card border border-border bg-surface p-4">
    <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-accent-text">Добавить лида</summary>
    {props.owners.length ? <ManualLeadEditor key={requestId} {...props} requestId={requestId} onAnother={() => setRequestId(crypto.randomUUID())} />
      : <p role="status" className="mt-3 text-sm text-fg-2">Нет доступного менеджера продаж. Попросите Admin добавить активного сотрудника Sales в настройках команды — после этого можно назначить ему нового лида.</p>}
  </details>;
}
function ManualLeadEditor({ requestId, ownerId, owners, onAnother }: Readonly<{ requestId: string; ownerId: string; owners: readonly Readonly<{ id: string; displayName: string }>[]; onAnother: () => void }>) {
  const frozen = useRef<FormData | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const [state, action, pending] = useActionState(async (previous: ManualLeadState, form: FormData): Promise<ManualLeadState> => {
    const submitted = frozen.current ?? form;
    frozen.current = submitted;
    try {
      const result = await createManualLeadAction(previous, submitted);
      if (result.status !== "unavailable") frozen.current = null;
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId, leadId: null } as ManualLeadState);
  const locked = pending || ["saved", "unavailable"].includes(state.status)
    || (state.status === "request_conflict" && currentRequestId === state.requestId);
  const messages: Record<ManualLeadState["status"], string> = {
    idle: "", saved: "Лид сохранён. Сообщения и приглашения не отправлялись.", duplicate: "Такой контакт уже есть. Откройте существующего лида; если ссылка недоступна, попросите Admin проверить контакт.",
    invalid: "Проверьте имя, контакт и дату следующего действия.", forbidden: "Нет права на это действие. Обновите страницу после проверки доступа.",
    request_conflict: "Запрос уже использован с другими данными. Сначала проверьте воронку.", unavailable: "Результат пока неизвестен. Данные сохранены в форме; безопасно повторите тот же запрос.",
  };
  return <form action={action} className="mt-4 max-w-3xl space-y-4" aria-busy={pending}>
    <input type="hidden" name="request_id" value={currentRequestId} />
    <fieldset disabled={locked} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={labelCls}>Имя</span><input name="name" required maxLength={300} className={inputCls} /></label>
        <label><span className={labelCls}>Телефон</span><input name="phone" type="tel" maxLength={50} className={inputCls} /></label>
        <label><span className={labelCls}>Email, если телефона нет</span><input name="email" type="email" maxLength={320} className={inputCls} /></label>
        <label><span className={labelCls}>Источник</span><select name="source" className={inputCls}>{Object.entries(MANUAL_LEAD_SOURCES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label><span className={labelCls}>Ответственный</span><select name="owner_id" defaultValue={ownerId} required className={inputCls}>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}</select></label>
        <label><span className={labelCls}>Направление</span><select name="direction" className={inputCls}><option value="">Пока не выбрано</option>{Object.entries(LEAD_DIRECTIONS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      </div>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Следующее действие</summary><div className="grid gap-4 sm:grid-cols-2">
        <label><span className={labelCls}>Что сделать</span><textarea name="next_action" maxLength={500} rows={2} className={inputCls} /></label>
        <label><span className={labelCls}>Срок</span><input name="due_date" type="date" className={inputCls} /></label>
      </div></details>
      <button className={btnCls} disabled={locked}>{pending ? "Сохраняем…" : "Сохранить лида"}</button>
    </fieldset>
    {state.status !== "idle" ? <p role={state.status === "saved" ? "status" : "alert"} className="text-sm leading-relaxed text-fg-2">{messages[state.status]}</p> : null}
    {state.leadId ? <Link className="inline-flex min-h-11 items-center text-accent-text underline" href={`/v3/profile?id=${state.leadId}`}>Открыть лида</Link> : null}
    {state.status === "unavailable" ? <button type="submit" className={btnCls} disabled={pending}>Повторить тот же запрос</button> : null}
    {state.status === "saved" ? <button type="button" className="min-h-11 text-sm underline" onClick={onAnother}>Добавить ещё одного</button> : null}
    {state.status === "request_conflict" ? <div className="flex flex-wrap gap-3"><Link href="/v3/pipeline" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">Проверить воронку в новой вкладке</Link>
      {currentRequestId === state.requestId ? <button type="button" className="min-h-11 text-sm underline" onClick={() => setCurrentRequestId(crypto.randomUUID())}>Проверил, продолжить с моим вводом</button> : null}</div> : null}
  </form>;
}
