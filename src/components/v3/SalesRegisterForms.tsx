"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import {
  saveSalesRegisterAction, saveSalesTargetAction, importSalesRegisterAction,
  searchSalesRegisterStudentsAction, readSalesReportConditionsPreviewAction,
  type SalesRegisterActionState, type SalesReportConditionsPreview,
} from "@/lib/platform-sales-register-actions";
import { SALES_CURRENCIES, type SalesRegisterRow, type SalesRegisterTarget, type SalesRegisterIntakeOptions } from "@/lib/platform-sales-register-contract";
import type { LeadSaleConditions } from "@/lib/lead-sale-conditions-contract";

const MESSAGES: Record<Exclude<SalesRegisterActionState["status"], "idle">, string> = {
  saved: "Сохранено в платформе.", invalid: "Проверьте поля, суммы, валюту и причину изменения.",
  forbidden: "Нет доступа к этому действию или сотруднику.",
  stale: "Запись изменил другой сотрудник. Ваш ввод сохранён. Обновите данные и сравните изменения.",
  request_conflict: "Этот запрос уже использован. Проверьте запись перед повтором.",
  unavailable: "Сохранение не подтверждено. Проверьте подключение и актуальную запись перед повтором.",
  already_transferred: "Этот студент уже передан куратору. Откройте существующую продажу в отчёте.",
  conditions_missing: "В карточке лида не заполнены условия продажи. Заполните их в карточке и повторите сохранение.",
};
type Draft = Record<string, string>;
const FIELD_LABELS: Record<string, string> = {
  report_month: "Месяц отчёта", signing_date: "Дата продажи", applicant_name: "Заявитель",
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
function previewMoney(minorValue: number | null, currency: string | null): string {
  return minorValue === null || !currency ? "не указано" : `${decimal(minorValue)} ${currency}`;
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
  ownerOptions: readonly Readonly<{ id: string; label: string }>[]; canChooseOwner: boolean;
  ownMembershipId: string; ownLabel: string; requestId: string; archiveRequestId: string; backHref: string; readUnavailable: boolean;
  intakeOptions?: SalesRegisterIntakeOptions | null;
}>;

export function SalesRegisterForm(props: FormProps) {
  const [lastRead, setLastRead] = useState(props.record);
  if (props.record && props.record !== lastRead) setLastRead(props.record);
  if (props.recordId && !lastRead) return <div className="space-y-4"><p role="alert" className="text-sm text-fg-2">Запись недоступна. Возможно, она была переназначена или соединение прервалось.</p><Link href={props.backHref} className={`${btnGhostCls} min-h-11`}>К отчёту</Link></div>;
  return <SalesDraft {...props} record={lastRead} readUnavailable={props.readUnavailable || Boolean(props.recordId && !props.record)} />;
}

/** «Заполнить условия в карточке» — plan §6: the report never re-collects
 * conditions, it only links back to the same lead card block. */
function ConditionsPreview({ leadId, preview, pending }: {
  leadId: string; preview: SalesReportConditionsPreview | null; pending: boolean;
}) {
  const cardHref = `/v3/profile?id=${encodeURIComponent(leadId)}&tab=overview#sale-conditions`;
  if (pending) return <p role="status" className="text-sm text-fg-2">Загружаем условия продажи из карточки…</p>;
  if (!preview || preview.status !== "ready") {
    return <p role="alert" className="text-sm text-fg-2">Не удалось загрузить условия продажи. Обновите страницу перед сохранением.</p>;
  }
  const conditions: LeadSaleConditions = preview.conditions;
  const missing = conditions.serviceCostMinor === null || !preview.reportMonth;
  if (missing) {
    return <div className="space-y-2 rounded-card border border-border p-4 text-sm" data-testid="v3-sales-conditions-missing">
      <p className="text-fg-2">Для добавления продажи заполните в карточке стоимость услуг и дату продажи.</p>
      <Link href={cardHref} className={`${btnGhostCls} min-h-11`}>Исправить условия</Link>
    </div>;
  }
  return <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-sm" data-testid="v3-sales-conditions-preview">
    <dt className="text-fg-3">Услуга/пакет</dt><dd className="text-right text-fg">{conditions.serviceLabel || "не указано"}</dd>
    <dt className="text-fg-3">Дата продажи</dt><dd className="text-right text-fg">{conditions.signingDate ? conditions.signingDate.split("-").reverse().join(".") : "не указана"}</dd>
    <dt className="text-fg-3">Месяц отчёта</dt><dd className="text-right font-medium text-fg">{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${preview.reportMonth}T00:00:00Z`))}</dd>
    <dt className="text-fg-3">Стоимость</dt><dd className="text-right font-mono text-fg">{previewMoney(conditions.serviceCostMinor, conditions.serviceCostCurrency)}</dd>
    <dt className="text-fg-3">Оплачено</dt><dd className="text-right font-mono text-fg">{previewMoney(conditions.paidMinor, conditions.paidCurrency)}</dd>
    {conditions.paymentNote ? <><dt className="text-fg-3">Об оплате</dt><dd className="text-right text-fg">{conditions.paymentNote}</dd></> : null}
    <dt className="col-span-2 border-t border-border pt-2 text-xs text-fg-3">
      <Link href={cardHref} className="inline-flex min-h-11 items-center text-sm text-fg underline underline-offset-4">Исправить условия</Link>
    </dt>
  </dl>;
}

function SalesDraft({ record, recordId, reportMonth, ownerOptions, canChooseOwner, ownMembershipId, ownLabel, requestId, archiveRequestId, backHref, readUnavailable, intakeOptions }: FormProps) {
  const router = useRouter();
  const [base, setBase] = useState({ version: record?.version ?? 0, values: fields(record, reportMonth, ownMembershipId, ownLabel) });
  const [draft, setDraft] = useState(base.values);
  const [reason, setReason] = useState("");
  const [leadId, setLeadId] = useState("");
  const [curatorId, setCuratorId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [studentResults, setStudentResults] = useState<SalesRegisterIntakeOptions["leads"]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "ready" | "invalid" | "unavailable">("idle");
  const [searchPending, startSearch] = useTransition();
  const [selectedLead, setSelectedLead] = useState<SalesRegisterIntakeOptions["leads"][number] | null>(null);
  const [conditionsPreview, setConditionsPreview] = useState<SalesReportConditionsPreview | null>(null);
  const [previewPending, startPreview] = useTransition();
  const selectionGeneration = useRef(0);
  const [state, action, pending] = useActionState(async (previous: SalesRegisterActionState & { submittedVersion: number }, form: FormData) => ({
    ...await saveSalesRegisterAction(previous, form), submittedVersion: base.version,
  }), { status: "idle", requestId, recordId, leadId: null, submittedVersion: base.version } as SalesRegisterActionState & { submittedVersion: number });
  useEffect(() => {
    if (!recordId && state.status === "saved" && state.recordId && state.reportMonth) {
      const params = new URLSearchParams({ view: "sales", year: state.reportMonth.slice(0, 4),
        month: String(Number(state.reportMonth.slice(5, 7))), saved: state.recordId });
      router.push(`/v3/main?${params.toString()}#saved-sale`);
    }
  }, [recordId, router, state.status, state.recordId, state.reportMonth]);
  const status = state.submittedVersion === base.version ? state.status : "idle";
  const fresh = fields(record, reportMonth, ownMembershipId, ownLabel);
  const displayValue = (key: string, value: string) => {
    if (key === "owner_membership_id") {
      if (!value) return "Не назначен";
      const owner = ownerOptions.find(option => option.id === value);
      return owner ? owner.label || "Сотрудник без имени" : "Сотрудник недоступен";
    }
    if (key === "needs_review") return value === "true" ? "Нужно уточнить" : "Данные уточнены";
    return value || "Не указано";
  };
  const changed = Boolean(record && record.version !== base.version);
  const locked = pending || status === "saved";
  const conditionsReady = !recordId ? conditionsPreview?.status === "ready" && conditionsPreview.conditions.serviceCostMinor !== null && Boolean(conditionsPreview.reportMonth) && conditionsPreview.conditions.leadId === leadId : true;
  const canSubmit = !locked && !readUnavailable && !changed && status !== "stale" && !record?.archived
    && (Boolean(recordId) || (Boolean(intakeOptions) && Boolean(curatorId) && Boolean(leadId) && conditionsReady));
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
    <h1 className="text-2xl font-semibold tracking-tight">{recordId ? "Запись продажи" : "Добавить продажу"}</h1>
    {record?.sourceKind === "pipeline" && record.leadId ? <Link href={`/v3/profile?id=${encodeURIComponent(record.leadId)}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Открыть профиль студента</Link> : null}
    {record?.archived ? <p className="text-sm text-fg-2">Эта запись в архиве и не входит в рабочие итоги. Для редактирования сначала восстановите её.</p> : null}
    <form action={action} aria-busy={pending} className="space-y-6" data-testid="sales-register-form">
      <input type="hidden" name="operation" value={recordId ? "update" : "create"} />
      <input type="hidden" name="record_id" value={recordId ?? ""} />
      <input type="hidden" name="expected_version" value={base.version} />
      <input type="hidden" name="request_id" value={state.requestId} />
      {!recordId ? <>
        <input type="hidden" name="lead_id" value={leadId} />
        <input type="hidden" name="curator_membership_id" value={curatorId} />
      </> : null}
      {recordId ? Object.entries(wire).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />) : null}
      <fieldset disabled={locked || record?.archived} className="space-y-6">
        {!recordId ? <>
          {/* «Выберите лида и куратора» — план §6: отчёт больше не создаёт
              нового студента и не переспрашивает условия продажи. */}
          <div className="space-y-4">
            <p className="text-sm text-fg-2">Выберите лида и куратора. Условия продажи и данные заявителя подставятся из карточки.</p>
            <label className="block"><span className={labelCls}>Имя или телефон</span><div className="flex gap-2">
              <input value={studentQuery} onChange={e => {
                selectionGeneration.current += 1;
                setStudentQuery(e.target.value); setLeadId(""); setSelectedLead(null); setStudentResults([]); setSearchStatus("idle"); setConditionsPreview(null);
              }} maxLength={200} className={`${inputCls} min-h-11 min-w-0 flex-1`} />
              <button type="button" disabled={searchPending || studentQuery.trim().length < 2} className={`${btnGhostCls} min-h-11`} onClick={() => startSearch(async () => {
                const generation = ++selectionGeneration.current;
                setLeadId(""); setSelectedLead(null); setConditionsPreview(null);
                const result = await searchSalesRegisterStudentsAction(studentQuery).catch(() => ({ status: "unavailable" as const, leads: [] }));
                if (generation !== selectionGeneration.current) return;
                setStudentResults(result.leads); setSearchStatus(result.status); setLeadId(""); setSelectedLead(null); setConditionsPreview(null);
              })}>{searchPending ? "Ищем…" : "Найти"}</button>
            </div></label>
            {searchStatus === "ready" && studentResults.length > 0 ? <label className="block"><span className={labelCls}>Выберите студента</span><select value={leadId} required onChange={e => {
              const generation = ++selectionGeneration.current;
              const lead = studentResults.find(item => item.id === e.target.value) ?? null;
              setLeadId(lead?.id ?? ""); setSelectedLead(lead); setConditionsPreview(null);
              if (lead) startPreview(async () => {
                const result = await readSalesReportConditionsPreviewAction(lead.id).catch(() => ({ status: "unavailable" as const }));
                if (generation === selectionGeneration.current) setConditionsPreview(result);
              });
            }} className={`${inputCls} min-h-11 w-full`}>
              <option value="">Выберите студента</option>{studentResults.map(lead => <option key={lead.id} value={lead.id}>{lead.label}{lead.phone ? ` · ${lead.phone}` : ""}</option>)}
            </select></label> : null}
            {searchStatus === "ready" && studentResults.length === 0 ? <p role="status" className="text-sm text-fg-2">Непереданных студентов не найдено. Уточните имя или телефон.</p> : null}
            {searchStatus === "unavailable" ? <p role="alert" className="text-sm text-fg-2">Поиск недоступен. Попробуйте ещё раз.</p> : null}
          </div>
          {selectedLead ? <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm"><span className={labelCls}>Заявитель</span><span className="block text-fg">{selectedLead.label}</span></p>
            <p className="text-sm"><span className={labelCls}>Телефон</span><span className="block text-fg">{selectedLead.phone || "не указан"}</span></p>
          </div> : null}
          <label className="block max-w-md"><span className={labelCls}>Куратор</span><select value={curatorId} required onChange={e => setCuratorId(e.target.value)} className={`${inputCls} min-h-11 w-full`}>
            <option value="">Выберите куратора</option>{intakeOptions?.curators.map(curator => <option value={curator.id} key={curator.id}>{curator.label}</option>)}
          </select></label>
          {intakeOptions && intakeOptions.curators.length === 0 ? <p role="alert" className="text-sm text-fg-2">Нет доступного куратора. Администратор может назначить роль сотруднику в настройках команды.</p> : null}
          {!intakeOptions ? <p role="alert" className="text-sm text-fg-2">Не удалось загрузить кураторов. Обновите страницу перед сохранением.</p> : null}
          {leadId ? <div className="border-t border-border pt-4">
            <h2 className="mb-2 text-sm font-semibold text-fg">Условия продажи</h2>
            <ConditionsPreview leadId={leadId} preview={conditionsPreview} pending={previewPending} />
          </div> : null}
        </> : null}
        {recordId ? <>
        <div className="grid gap-4 sm:grid-cols-2">{input("applicant_name", "text", true, 300)}{input("phone", "tel")}{input("report_month", "month", true)}{input("signing_date", "date")}</div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3 border-t border-border pt-4"><div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
            <label><span className={labelCls}>Стоимость услуг</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={draft.cost} onChange={e => update("cost", e.target.value)} className={`${inputCls} min-h-11 w-full`} /></label>{currency("service_cost_currency")}
          </div>{record?.serviceCostRaw ? <p className="break-words text-xs text-fg-3">В источнике: {record.serviceCostRaw}</p> : null}</div>
          <div className="space-y-3 border-t border-border pt-4"><div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
            <label><span className={labelCls}>Оплачено по записи</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={draft.paid} onChange={e => update("paid", e.target.value)} className={`${inputCls} min-h-11 w-full`} /></label>{currency("paid_currency")}
          </div>{record?.paidRaw ? <p className="break-words text-xs text-fg-3">В источнике: {record.paidRaw}</p> : null}</div>
        </div>
        <p className="text-xs text-fg-3">Если сумма неизвестна, оставьте сумму и валюту пустыми.</p>
        <div className="grid gap-4 sm:grid-cols-2">{input("manager_label", "text", false, 300)}
          {canChooseOwner ? <label><span className={labelCls}>Ответственный за продажу</span><select value={draft.owner_membership_id} disabled={locked} onChange={e => update("owner_membership_id", e.target.value)} className={`${inputCls} min-h-11 w-full`}>
            <option value="">Не назначен</option>{ownerOptions.map(owner => <option value={owner.id} key={owner.id}>{owner.label || "Сотрудник без имени"}</option>)}
          </select></label> : null}
        </div>
        <details><summary className="cursor-pointer py-3 text-sm font-medium">Программа и договор</summary><div className="mt-3 grid gap-4 sm:grid-cols-2">
          {input("country")}{input("university", "text", false, 500)}{input("program", "text", false, 500)}{input("direction", "text", false, 500)}{input("intake")}{input("contract_number")}{input("status_raw", "text", false, 2000)}
        </div></details>
        <label className="block"><span className={labelCls}>Примечание</span><textarea value={draft.notes} onChange={e => update("notes", e.target.value)} maxLength={2000} rows={3} className={`${inputCls} w-full`} /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.needs_review === "true"} onChange={e => update("needs_review", String(e.target.checked))} className="h-5 w-5" />Нужно уточнить данные</label>
        <label className="block"><span className={labelCls}>Причина изменения</span><input name="reason" value={reason} onChange={e => setReason(e.target.value)} required maxLength={1000} className={`${inputCls} min-h-11 w-full`} /></label>
        </> : null}
      </fieldset>
      {readUnavailable ? <p role="alert" className="text-sm text-fg-2">Актуальные данные недоступны. Ввод сохранён; отправка остановлена.</p> : null}
      {status !== "idle" ? <p role={status === "saved" ? "status" : "alert"} className="text-sm text-fg-2">{status === "saved" && !recordId ? "Продажа добавлена" : MESSAGES[status]}</p> : null}
      {status === "conditions_missing" && leadId ? <Link href={`/v3/profile?id=${encodeURIComponent(leadId)}&tab=overview`} className={`${btnGhostCls} min-h-11`}>Заполнить условия в карточке</Link> : null}
      {changed ? <div className="space-y-3 border-s-2 border-border ps-4">
        <p className="text-sm font-medium">Изменения другого сотрудника</p>
        <ul className="space-y-2 text-sm text-fg-2">{Object.keys(fresh).filter(key => fresh[key] !== base.values[key]).map(key => <li key={key} className="break-words">{FIELD_LABELS[key]}: {displayValue(key, fresh[key])}. {draft[key] !== base.values[key] ? `Ваш ввод: ${displayValue(key, draft[key])}.` : "Будет обновлено в форме."}</li>)}</ul>
        <button type="button" className={`${btnGhostCls} min-h-11`} disabled={pending || readUnavailable} onClick={() => {
          setDraft(previous => Object.fromEntries(Object.keys(fresh).map(key => [key, previous[key] === base.values[key] ? fresh[key] : previous[key]])));
          setBase({ version: record!.version, values: fresh });
        }}>Сверил изменения, продолжить с моим вводом</button>
      </div> : null}
      {status === "stale" || status === "unavailable" || readUnavailable ? <button type="button" className={`${btnGhostCls} min-h-11`} disabled={pending} onClick={() => router.refresh()}>Обновить данные без сброса ввода</button> : null}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={!canSubmit} className={`${btnCls} min-h-11`}>{pending ? "Сохраняем…" : recordId ? "Сохранить продажу" : "Сохранить"}</button><Link href={backHref} className={`${btnGhostCls} min-h-11`}>{status === "saved" ? "Готово — к отчёту" : "Отмена"}</Link></div>
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
  }), { status: "idle", requestId, recordId: record.id, leadId: null, submittedVersion: expectedVersion } as SalesRegisterActionState & { submittedVersion: number });
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
  const [state, action, pending] = useActionState(async (previous: SalesRegisterActionState & { submittedVersion: number }, form: FormData) => {
    if (readUnavailable) return { ...previous, status: "unavailable" as const };
    return { ...await saveSalesTargetAction(previous, form), submittedVersion: base?.version ?? 0 };
  }, { status: "idle", requestId, recordId: target?.id ?? null, leadId: null, submittedVersion: base?.version ?? 0 } as SalesRegisterActionState & { submittedVersion: number });
  const status = state.submittedVersion === (base?.version ?? 0) ? state.status : "idle";
  const changed = !readUnavailable && base?.version !== current?.version;
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

export function SalesRegisterImport({ requestId, readUnavailable = false }: { requestId: string; readUnavailable?: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [state, action, pending] = useActionState(async (previous: Awaited<ReturnType<typeof importSalesRegisterAction>>, form: FormData) => {
    if (readUnavailable) return { ...previous, status: "unavailable" as const };
    if (file) form.set("import_file", file);
    return importSalesRegisterAction(previous, form);
  }, { status: "idle", requestId, recordId: null, leadId: null, importResult: null } as Awaited<ReturnType<typeof importSalesRegisterAction>>);
  return <form action={action} aria-busy={pending} className="mt-3 max-w-xl space-y-3">
    <input type="hidden" name="request_id" value={state.requestId} />
    <p className="text-sm text-fg-3">Однократная загрузка подготовленной копии. Повтор не добавляет дубли и не заменяет исправления сотрудников. Google-таблица не изменяется.</p>
    <label className="block"><span className={labelCls}>Подготовленный файл переноса (.json)</span><input type="file" accept=".json,application/json" onChange={e => setFile(e.target.files?.[0] ?? null)} disabled={pending || readUnavailable || state.status === "saved"} className="min-h-11 max-w-full text-sm" /></label>
    {file ? <p className="break-words text-xs text-fg-3">Выбран: {file.name}</p> : null}
    {state.status !== "idle" ? <p role={state.status === "saved" ? "status" : "alert"} className="text-sm">{MESSAGES[state.status]}</p> : null}
    {state.importResult ? <div role="status" className="space-y-2 text-sm"><p>Добавлено записей: {state.importResult.inserted}. Уже были перенесены: {state.importResult.skipped}. Добавлено планов: {state.importResult.targetsInserted}.</p>
      {state.importResult.mismatches || state.importResult.targetsMismatched ? <p>Есть расхождения с ранее перенесёнными данными: записи — {state.importResult.mismatches}, планы — {state.importResult.targetsMismatched}. Существующие данные не перезаписаны.</p> : null}</div> : null}
    {readUnavailable ? <div className="space-y-2"><p role="alert" className="text-sm">{file ? "Перенос временно недоступен. Выбранный файл сохранён; отправка остановлена." : "Перенос временно недоступен. Проверьте доступ перед выбором файла."}</p><button type="button" disabled={pending} className={`${btnGhostCls} min-h-11`} onClick={() => router.refresh()}>Проверить доступ к переносу</button></div> : null}
    <button disabled={!file || pending || readUnavailable || state.status === "saved"} className={`${btnCls} min-h-11`}>{pending ? "Переносим записи…" : "Перенести записи в платформу"}</button>
  </form>;
}
