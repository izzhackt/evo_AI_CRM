"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import {
  saveSalesRegisterAction, saveSalesTargetAction, importSalesRegisterAction,
  type SalesRegisterActionState,
} from "@/lib/platform-sales-register-actions";
import { SALES_CURRENCIES, type SalesRegisterRow, type SalesRegisterTarget } from "@/lib/platform-sales-register-contract";

const MESSAGES: Record<Exclude<SalesRegisterActionState["status"], "idle">, string> = {
  saved: "Сохранено в платформе.", invalid: "Проверьте поля, суммы, валюту и причину изменения.",
  forbidden: "Нет доступа к этому действию или сотруднику.",
  stale: "Запись изменил другой сотрудник. Ваш ввод сохранён. Обновите данные и сравните изменения.",
  request_conflict: "Этот запрос уже использован. Проверьте запись перед повтором.",
  unavailable: "Сохранение не подтверждено. Проверьте подключение и актуальную запись перед повтором.",
};
type Draft = Record<string, string>;
const FIELD_LABELS: Record<string, string> = {
  report_month: "Месяц отчёта", signing_date: "Дата договора", applicant_name: "Заявитель",
  phone: "Телефон", country: "Страна", university: "Университет", program: "Программа",
  direction: "Направление", intake: "Набор", contract_number: "Номер договора",
  manager_label: "Менеджер в отчёте", status_raw: "Статус в отчёте", owner_membership_id: "Ответственный сотрудник",
  cost: "Стоимость", service_cost_currency: "Валюта стоимости", service_cost_raw: "Исходная стоимость",
  paid: "Оплачено по записи", paid_currency: "Валюта оплаты", paid_raw: "Исходная оплата",
  needs_review: "Нужно уточнить", notes: "Примечание",
};
function decimal(minor: number | null): string { return minor === null ? "" : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`; }
function minor(value: string): string {
  if (value.trim() === "") return "";
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(normalized)) return "invalid";
  const [whole, cents = ""] = normalized.split(".");
  return String(BigInt(whole) * BigInt(100) + BigInt(cents.padEnd(2, "0")));
}
function fields(row: SalesRegisterRow | null, reportMonth: string, owner: string, label: string): Draft {
  return {
    report_month: (row?.reportMonth ?? reportMonth).slice(0, 7), signing_date: row?.signingDate ?? "",
    applicant_name: row?.applicantName ?? "", phone: row?.phone ?? "", country: row?.country ?? "",
    university: row?.university ?? "", program: row?.program ?? "", direction: row?.direction ?? "", intake: row?.intake ?? "",
    contract_number: row?.contractNumber ?? "", manager_label: row?.managerLabel ?? label, status_raw: row?.statusRaw ?? "",
    owner_membership_id: row ? row.ownerMembershipId ?? "" : owner,
    service_cost_raw: row?.serviceCostRaw ?? "", cost: decimal(row?.serviceCostMinor ?? null), service_cost_currency: row?.serviceCostCurrency ?? "",
    paid_raw: row?.paidRaw ?? "", paid: decimal(row?.paidMinor ?? null), paid_currency: row?.paidCurrency ?? "",
    needs_review: String(row?.needsReview ?? true), notes: row?.notes ?? "",
  };
}
type FormProps = Readonly<{
  record: SalesRegisterRow | null; recordId: string | null; reportMonth: string;
  ownerOptions: readonly Readonly<{ id: string; label: string }>[]; isAdmin: boolean;
  ownMembershipId: string; ownLabel: string; requestId: string; archiveRequestId: string; backHref: string; readUnavailable: boolean;
}>;

export function SalesRegisterForm(props: FormProps) {
  const [lastRead, setLastRead] = useState(props.record);
  if (props.record && props.record !== lastRead) setLastRead(props.record);
  if (props.recordId && !lastRead) return <div className="space-y-4"><p role="alert" className="text-sm text-fg-2">Запись недоступна. Возможно, она была переназначена или соединение прервалось.</p><Link href={props.backHref} className={`${btnGhostCls} min-h-11`}>К отчёту</Link></div>;
  return <SalesDraft {...props} record={lastRead} readUnavailable={props.readUnavailable || Boolean(props.recordId && !props.record)} />;
}
function SalesDraft({ record, recordId, reportMonth, ownerOptions, isAdmin, ownMembershipId, ownLabel, requestId, archiveRequestId, backHref, readUnavailable }: FormProps) {
  const router = useRouter();
  const [base, setBase] = useState({ version: record?.version ?? 0, values: fields(record, reportMonth, ownMembershipId, ownLabel) });
  const [draft, setDraft] = useState(base.values);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(async (previous: SalesRegisterActionState & { submittedVersion: number }, form: FormData) => ({
    ...await saveSalesRegisterAction(previous, form), submittedVersion: base.version,
  }), { status: "idle", requestId, recordId, submittedVersion: base.version } as SalesRegisterActionState & { submittedVersion: number });
  const status = state.submittedVersion === base.version ? state.status : "idle";
  const fresh = fields(record, reportMonth, ownMembershipId, ownLabel);
  const displayValue = (key: string, value: string) => {
    if (key === "owner_membership_id") return value ? ownerOptions.find(owner => owner.id === value)?.label ?? "Сотрудник недоступен" : "Не назначен";
    if (key === "needs_review") return value === "true" ? "Нужно уточнить" : "Данные уточнены";
    return value || "Не указано";
  };
  const changed = Boolean(record && record.version !== base.version);
  const locked = pending || status === "saved";
  const canSubmit = !locked && !readUnavailable && !changed && status !== "stale" && !record?.archived;
  const update = (key: string, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  const wire: Draft = { ...draft, report_month: `${draft.report_month}-01`, service_cost_minor: minor(draft.cost), paid_minor: minor(draft.paid) };
  delete wire.cost; delete wire.paid;
  const input = (key: string, type = "text", required = false, maxLength = 200) => <label key={key} className="block min-w-0"><span className={labelCls}>{FIELD_LABELS[key]}</span>
    <input type={type} value={draft[key]} onChange={event => update(key, event.target.value)} required={required} maxLength={maxLength}
      min={type === "month" ? "1900-01" : type === "date" ? "1900-01-01" : undefined}
      max={type === "month" ? "2100-12" : type === "date" ? "2100-12-31" : undefined}
      className={`${inputCls} min-h-11 w-full`} /></label>;
  const currency = (key: string) => <label className="block"><span className={labelCls}>Валюта</span><select value={draft[key]} onChange={event => update(key, event.target.value)} className={`${inputCls} min-h-11 w-full`}>
    <option value="">Не указана</option>{SALES_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
  </select></label>;

  return <div className="space-y-6">
    <Link href={backHref} className={`${btnGhostCls} min-h-11`}>← К отчёту</Link>
    <h2 className="text-xl font-semibold">{recordId ? "Запись продажи" : "Новая продажа"}</h2>
    {record?.sourceKind === "pipeline" && record.leadId ? <p className="text-sm text-fg-3">Добавлена после передачи из воронки. <Link href={`/v3/profile?id=${encodeURIComponent(record.leadId)}`} className="inline-flex min-h-11 items-center underline underline-offset-4">Открыть профиль</Link></p> : null}
    {record?.archived ? <p className="text-sm text-fg-2">Эта запись в архиве и не входит в рабочие итоги. Для редактирования сначала восстановите её.</p> : null}
    <form action={action} aria-busy={pending} className="space-y-6" data-testid="sales-register-form">
      <input type="hidden" name="operation" value={recordId ? "update" : "create"} />
      <input type="hidden" name="record_id" value={recordId ?? ""} />
      <input type="hidden" name="expected_version" value={base.version} />
      <input type="hidden" name="request_id" value={state.requestId} />
      {Object.entries(wire).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
      <fieldset disabled={locked || record?.archived} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">{input("applicant_name", "text", true, 300)}{input("phone", "tel")}{input("report_month", "month", true)}{input("signing_date", "date")}</div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3 border-t border-border pt-4"><div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <label><span className={labelCls}>Стоимость услуг</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={draft.cost} onChange={e => update("cost", e.target.value)} className={`${inputCls} min-h-11 w-full`} /></label>{currency("service_cost_currency")}
          </div>{record?.serviceCostRaw ? <p className="break-words text-xs text-fg-3">В источнике: {record.serviceCostRaw}</p> : null}</div>
          <div className="space-y-3 border-t border-border pt-4"><div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <label><span className={labelCls}>Оплачено по записи</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={draft.paid} onChange={e => update("paid", e.target.value)} className={`${inputCls} min-h-11 w-full`} /></label>{currency("paid_currency")}
          </div>{record?.paidRaw ? <p className="break-words text-xs text-fg-3">В источнике: {record.paidRaw}</p> : null}</div>
        </div>
        <p className="text-xs text-fg-3">Если сумма неизвестна, оставьте сумму и валюту пустыми. Это отчётная запись, а не подтверждение платежа.</p>
        <div className="grid gap-4 sm:grid-cols-2">{input("manager_label", "text", false, 300)}
          {isAdmin ? <label><span className={labelCls}>Ответственный в платформе</span><select value={draft.owner_membership_id} onChange={e => update("owner_membership_id", e.target.value)} className={`${inputCls} min-h-11 w-full`}>
            <option value="">Пока не назначен — доступ только Admin</option>{ownerOptions.map(owner => <option value={owner.id} key={owner.id}>{owner.label}</option>)}
          </select></label> : null}
        </div>
        <details><summary className="cursor-pointer py-3 text-sm font-medium">Программа и договор</summary><div className="mt-3 grid gap-4 sm:grid-cols-2">
          {input("country")}{input("university", "text", false, 500)}{input("program", "text", false, 500)}{input("direction", "text", false, 500)}{input("intake")}{input("contract_number")}{input("status_raw", "text", false, 2000)}
        </div></details>
        <label className="block"><span className={labelCls}>Примечание</span><textarea value={draft.notes} onChange={e => update("notes", e.target.value)} maxLength={2000} rows={3} className={`${inputCls} w-full`} /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.needs_review === "true"} onChange={e => update("needs_review", String(e.target.checked))} className="h-5 w-5" />Нужно уточнить данные</label>
        <label className="block"><span className={labelCls}>{recordId ? "Причина изменения" : "Основание записи"}</span><input name="reason" value={reason} onChange={e => setReason(e.target.value)} required maxLength={1000} className={`${inputCls} min-h-11 w-full`} /></label>
      </fieldset>
      {readUnavailable ? <p role="alert" className="text-sm text-fg-2">Актуальные данные недоступны. Ввод сохранён; отправка остановлена.</p> : null}
      {status !== "idle" ? <p role={status === "saved" ? "status" : "alert"} className="text-sm text-fg-2">{MESSAGES[status]}</p> : null}
      {changed ? <div className="space-y-3 border-s-2 border-border ps-4">
        <p className="text-sm font-medium">Изменения другого сотрудника</p>
        <ul className="space-y-2 text-sm text-fg-2">{Object.keys(fresh).filter(key => fresh[key] !== base.values[key]).map(key => <li key={key} className="break-words">{FIELD_LABELS[key]}: {displayValue(key, fresh[key])}. {draft[key] !== base.values[key] ? `Ваш ввод: ${displayValue(key, draft[key])}.` : "Будет обновлено в форме."}</li>)}</ul>
        <button type="button" className={`${btnGhostCls} min-h-11`} disabled={pending || readUnavailable} onClick={() => {
          setDraft(previous => Object.fromEntries(Object.keys(fresh).map(key => [key, previous[key] === base.values[key] ? fresh[key] : previous[key]])));
          setBase({ version: record!.version, values: fresh });
        }}>Сверил изменения, продолжить с моим вводом</button>
      </div> : null}
      {status === "stale" || status === "unavailable" || readUnavailable ? <button type="button" className={`${btnGhostCls} min-h-11`} disabled={pending} onClick={() => router.refresh()}>Обновить данные без сброса ввода</button> : null}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={!canSubmit} className={`${btnCls} min-h-11`}>{pending ? "Сохраняем…" : "Сохранить продажу"}</button><Link href={backHref} className={`${btnGhostCls} min-h-11`}>{status === "saved" ? "Готово — к отчёту" : "Отмена"}</Link></div>
    </form>
    {record ? <details className="border-t border-border pt-3"><summary className="cursor-pointer py-3 text-sm font-medium">Источник и архив</summary>
      {record.sourceSheet ? <p className="my-3 text-sm text-fg-3">Импорт: {record.sourceSheet}, строка {record.sourceRow}. Исходный файл не изменён.</p> : null}
      <ArchiveForm key={record.id} record={record} expectedVersion={base.version} requestId={archiveRequestId} disabled={readUnavailable || changed || pending || status === "saved"} backHref={backHref} />
    </details> : null}
  </div>;
}

function ArchiveForm({ record, expectedVersion, requestId, disabled, backHref }: { record: SalesRegisterRow; expectedVersion: number; requestId: string; disabled: boolean; backHref: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(async (previous: SalesRegisterActionState & { submittedVersion: number }, form: FormData) => ({
    ...await saveSalesRegisterAction(previous, form), submittedVersion: expectedVersion,
  }), { status: "idle", requestId, recordId: record.id, submittedVersion: expectedVersion } as SalesRegisterActionState & { submittedVersion: number });
  const status = state.submittedVersion === expectedVersion ? state.status : "idle";
  return <form action={action} className="space-y-3" aria-busy={pending}>
    <input type="hidden" name="operation" value={record.archived ? "restore" : "archive"} /><input type="hidden" name="record_id" value={record.id} />
    <input type="hidden" name="expected_version" value={expectedVersion} /><input type="hidden" name="request_id" value={state.requestId} />
    <p className="text-sm text-fg-3">{record.archived ? "Запись снова войдёт в рабочий отчёт." : "Ошибочную запись можно убрать из рабочих итогов. История сохранится, восстановление доступно здесь."}</p>
    <label className="block"><span className={labelCls}>Причина</span><input name="reason" required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className={`${inputCls} min-h-11 w-full`} /></label>
    {status !== "idle" ? <p role={status === "saved" ? "status" : "alert"} className="text-sm">{MESSAGES[status]}</p> : null}
    {status === "stale" || status === "unavailable" ? <button type="button" className={`${btnGhostCls} min-h-11`} disabled={pending} onClick={() => router.refresh()}>Обновить и сверить запись выше</button> : null}
    {status === "saved" ? <Link href={backHref} className={`${btnGhostCls} min-h-11`}>К отчёту</Link> : <button disabled={disabled || pending || status === "stale"} className={`${btnGhostCls} min-h-11`}>{pending ? "Сохраняем…" : record.archived ? "Восстановить запись" : "Архивировать запись"}</button>}
  </form>;
}

export function SalesTargetForm({ reportMonth, target, requestId, readUnavailable }: { reportMonth: string; target: SalesRegisterTarget | null; requestId: string; readUnavailable: boolean }) {
  const router = useRouter();
  const [lastRead, setLastRead] = useState(target);
  if (!readUnavailable && target !== lastRead) setLastRead(target);
  const current = readUnavailable ? lastRead : target;
  const [base, setBase] = useState(target);
  const [count, setCount] = useState(target ? String(target.targetCount) : "");
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(async (previous: SalesRegisterActionState & { submittedVersion: number }, form: FormData) => ({
    ...await saveSalesTargetAction(previous, form), submittedVersion: base?.version ?? 0,
  }), { status: "idle", requestId, recordId: target?.id ?? null, submittedVersion: base?.version ?? 0 } as SalesRegisterActionState & { submittedVersion: number });
  const status = state.submittedVersion === (base?.version ?? 0) ? state.status : "idle";
  const changed = !readUnavailable && base?.version !== current?.version;
  useEffect(() => { if (state.status === "saved") router.refresh(); }, [state.status, router]);
  return <form action={action} aria-busy={pending} className="mt-3 max-w-md space-y-3">
    <input type="hidden" name="request_id" value={state.requestId} /><input type="hidden" name="record_id" value={base?.id ?? ""} />
    <input type="hidden" name="expected_version" value={base?.version ?? 0} /><input type="hidden" name="report_month" value={reportMonth} /><input type="hidden" name="manager_label" value="" />
    <label className="block"><span className={labelCls}>План отдела — количество продаж</span><input name="target_count" type="number" required min="0" max="1000000" value={count} onChange={e => setCount(e.target.value)} className={`${inputCls} min-h-11 w-full`} /></label>
    <label className="block"><span className={labelCls}>Причина</span><input name="reason" value={reason} onChange={e => setReason(e.target.value)} required maxLength={1000} className={`${inputCls} min-h-11 w-full`} /></label>
    {status !== "idle" ? <p role={status === "saved" ? "status" : "alert"} className="text-sm">{MESSAGES[status]}</p> : null}
    {readUnavailable ? <p role="alert" className="text-sm">Актуальный план недоступен. Ваш ввод сохранён; отправка остановлена.</p> : null}
    {changed || status === "stale" || status === "unavailable" || readUnavailable ? <div className="space-y-2">
      {!readUnavailable ? <p className="text-sm">Текущий план: {current?.targetCount ?? "не задан"}. Ваш ввод сохранён.</p> : null}
      <button type="button" className={`${btnGhostCls} min-h-11`} disabled={pending} onClick={() => router.refresh()}>Проверить актуальный план</button><button type="button" disabled={!changed || pending || readUnavailable} className={`${btnGhostCls} min-h-11`} onClick={() => { setBase(current); setCount(current ? String(current.targetCount) : ""); }}>Загрузить актуальное значение вместо моего ввода</button></div> : null}
    <button disabled={pending || readUnavailable || changed || status === "saved" || status === "stale"} className={`${btnCls} min-h-11`}>{pending ? "Сохраняем…" : "Сохранить план"}</button>
  </form>;
}

export function SalesRegisterImport({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [state, action, pending] = useActionState(async (previous: Awaited<ReturnType<typeof importSalesRegisterAction>>, form: FormData) => {
    if (file) form.set("import_file", file);
    return importSalesRegisterAction(previous, form);
  }, { status: "idle", requestId, recordId: null, importResult: null } as Awaited<ReturnType<typeof importSalesRegisterAction>>);
  useEffect(() => { if (state.status === "saved") router.refresh(); }, [state.status, router]);
  return <form action={action} aria-busy={pending} className="mt-3 max-w-xl space-y-3">
    <input type="hidden" name="request_id" value={state.requestId} />
    <p className="text-sm text-fg-3">Однократная загрузка подготовленной копии. Повтор не добавляет дубли и не заменяет исправления сотрудников. Google-таблица не изменяется.</p>
    <label className="block"><span className={labelCls}>Подготовленный файл переноса (.json)</span><input type="file" accept=".json,application/json" onChange={e => setFile(e.target.files?.[0] ?? null)} disabled={pending || state.status === "saved"} className="min-h-11 max-w-full text-sm" /></label>
    {file ? <p className="break-words text-xs text-fg-3">Выбран: {file.name}</p> : null}
    {state.status !== "idle" ? <p role={state.status === "saved" ? "status" : "alert"} className="text-sm">{MESSAGES[state.status]}</p> : null}
    {state.importResult ? <div role="status" className="space-y-2 text-sm"><p>Добавлено записей: {state.importResult.inserted}. Уже были перенесены: {state.importResult.skipped}. Добавлено планов: {state.importResult.targetsInserted}.</p>
      {state.importResult.mismatches || state.importResult.targetsMismatched ? <p>Есть расхождения с ранее перенесёнными данными: записи — {state.importResult.mismatches}, планы — {state.importResult.targetsMismatched}. Существующие данные не перезаписаны.</p> : null}</div> : null}
    <button disabled={!file || pending || state.status === "saved"} className={`${btnCls} min-h-11`}>{pending ? "Переносим записи…" : "Перенести записи в платформу"}</button>
  </form>;
}
