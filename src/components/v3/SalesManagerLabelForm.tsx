"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import { fieldLabelCls, inputCls } from "@/components/ui";
import { saveSalesManagerLabelAction, type SalesManagerLabelActionState } from "@/lib/platform-sales-register-actions";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "./queue/queue-buttons";

/** Сетка строки на широком экране: написания · записей · сотрудник · имя · сохранить. */
export const MANAGER_ROW_GRID = "md:grid md:grid-cols-[minmax(0,1.3fr)_5.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start md:gap-x-4";

const MESSAGES: Record<Exclude<SalesManagerLabelActionState["status"], "idle">, string> = {
  saved: "Сохранено.",
  invalid: "Проверьте имя: до 300 символов, без переносов строк; сотруднику нужно имя.",
  forbidden: "Нет доступа к сопоставлению менеджеров.",
  stale: "Имя уже изменил другой сотрудник. Обновите страницу и сравните.",
  request_conflict: "Этот запрос уже использован. Обновите страницу перед повтором.",
  unavailable: "Сохранение не подтверждено. Проверьте подключение и обновите страницу.",
};

/**
 * Строка «Менеджеры в отчёте» (Э8.6): «Сотрудник» (необязательно) и «Имя в
 * отчёте» для одного ключа написания; выбор сотрудника подставляет его имя,
 * если своё ещё не введено. Пустое имя без сотрудника снимает сопоставление.
 * Сохранение — тёмная нейтральная кнопка строки; версия — оптимистичная.
 */
export function SalesManagerLabelForm({ requestId, labelKey, version, name, membershipId, fallback, staffOptions, children }: Readonly<{
  requestId: string; labelKey: string; version: number; name: string; membershipId: string;
  /** Как отчёт называет ключ сейчас — подсказка пустого поля. */
  fallback: string;
  staffOptions: readonly Readonly<{ id: string; label: string }>[];
  /** Написания и число записей — левые столбцы строки. */
  children: ReactNode;
}>) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(name);
  const [staff, setStaff] = useState(membershipId);
  const [state, action, pending] = useActionState(saveSalesManagerLabelAction,
    { status: "idle", requestId, key: labelKey } as SalesManagerLabelActionState);
  const changed = displayName.trim() !== name || staff !== membershipId;
  const staffLabel = (id: string) => staffOptions.find((option) => option.id === id)?.label || "Сотрудник без имени";
  const clearing = !displayName.trim() && !staff;
  const fieldId = `manager-${labelKey.replace(/[^\p{L}\p{N}]+/gu, "-")}`;
  return <form action={action} aria-busy={pending} aria-label={`Имя в отчёте для «${fallback}»`}
    className={MANAGER_ROW_GRID}>
    <input type="hidden" name="request_id" value={state.requestId} />
    <input type="hidden" name="label_key" value={labelKey} />
    <input type="hidden" name="expected_version" value={version} />
    {children}
    <label className="mt-3 block min-w-0 md:mt-0">
      <span className={`${fieldLabelCls} md:sr-only`}>Сотрудник</span>
      <select name="membership_id" value={staff} disabled={pending} onChange={(event) => {
        const next = event.target.value;
        // Имя сотрудника подставляется, только если своё имя ещё не введено.
        if (next && (!displayName.trim() || (staff && displayName.trim() === staffLabel(staff)))) setDisplayName(staffLabel(next));
        setStaff(next);
      }} className={`${inputCls} min-h-11`}>
        <option value="">Не выбран</option>
        {staffOptions.map((option) => <option key={option.id} value={option.id}>{option.label || "Сотрудник без имени"}</option>)}
      </select>
    </label>
    <label className="mt-3 block min-w-0 md:mt-0">
      <span className={`${fieldLabelCls} md:sr-only`}>Имя в отчёте</span>
      <input id={fieldId} name="display_name" value={displayName} maxLength={300} placeholder={fallback} disabled={pending}
        onChange={(event) => setDisplayName(event.target.value)} className={`${inputCls} min-h-11`} />
    </label>
    <div className="mt-3 flex flex-wrap items-center gap-2 md:mt-0 md:w-28 md:flex-col md:items-stretch">
      <button type="submit" disabled={pending || !changed || (clearing && !name) || (Boolean(staff) && !displayName.trim())}
        className={QUEUE_CONFIRM}>{pending ? "Сохраняем…" : clearing && name ? "Снять имя" : "Сохранить"}</button>
      {state.status === "stale" || state.status === "unavailable" ? <button type="button" className={QUEUE_SECONDARY}
        onClick={() => router.refresh()}>Обновить</button> : null}
    </div>
    {state.status !== "idle" ? <p role={state.status === "saved" ? "status" : "alert"} className="mt-2 t-meta text-fg-2 md:col-span-5 md:text-right">
      {MESSAGES[state.status]}
    </p> : null}
  </form>;
}
