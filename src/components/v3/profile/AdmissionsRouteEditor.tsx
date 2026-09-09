"use client";

import { useEffect, useRef, useState } from "react";
import { executeAdmissionsCommandAction } from "@/lib/platform-admissions-playbook-actions";
import { installAssessmentExitGuard } from "@/lib/student-assessment-exit-guard";
import type { AdmissionsCommand, AdmissionsCommandResult } from "@/lib/platform-admissions-playbook-command";
import type { AdmissionsField } from "@/lib/platform-admissions-playbook-contract";

export const ADMISSIONS_INPUT = "min-h-11 min-w-0 w-full rounded-nav border border-control-edge bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
export const ADMISSIONS_BUTTON = "inline-flex min-h-11 items-center justify-center rounded-nav border border-control-edge px-4 text-sm font-semibold text-fg hover:bg-surface-2 disabled:opacity-50";
const ENUM_LABELS: Record<string, string> = { needs_confirmation: "Нужно уточнить", required: "Требуется", not_required: "Не требуется — есть основание", pending: "Ожидается", confirmed: "Подтверждено", approved: "Одобрено", rejected: "Отказ", pre_admission: "Предварительное решение (pre-admission)", conditional: "Предложение с условиями", unconditional: "Окончательное предложение без условий", enrolled: "Зачисление подтверждено", draft: "Черновик", rework: "Нужно уточнить" };
export function admissionsValueLabel(value: string): string { return ENUM_LABELS[value] ?? value; }

export function AdmissionsFieldInput({ field, value, onChange, documents }: {
  field: AdmissionsField; value: string; onChange: (value: string) => void;
  documents: readonly { id: string; name: string }[];
}) {
  if (field.key === "documentSlotIds" || field.key === "documentExceptionSlotIds") {
    const selected = value ? value.split(",") : [];
    const unavailable = selected.filter((id) => !documents.some((document) => document.id === id));
    return <fieldset className="rounded-nav border border-border p-3 sm:col-span-2"><legend className="px-1 text-sm font-medium text-fg-2">{field.label}</legend>
      <p className="mb-2 text-xs leading-5 text-fg-3">Здесь показаны активные пункты, связанные именно с этой заявкой. Добавьте или измените связь во вкладке «Документы».</p>
      {unavailable.length ? <div className="mb-3 space-y-2"><p className="text-sm text-danger">Ранее выбранные пункты больше не связаны с этой заявкой или удалены: {unavailable.length}. Восстановите связь либо уберите их из выбора.</p><button type="button" className={ADMISSIONS_BUTTON} onClick={() => onChange(selected.filter((id) => !unavailable.includes(id)).join(","))}>Убрать недоступные пункты из выбора</button></div> : null}
      {!documents.length ? <p className="text-sm text-fg-2">Сначала свяжите нужные пункты с этой заявкой во вкладке «Документы».</p> : documents.map((document) => <label key={document.id} className="flex min-h-11 items-center gap-3 text-sm text-fg">
        <input type="checkbox" className="size-5 accent-accent" checked={selected.includes(document.id)} onChange={(event) => onChange((event.target.checked ? [...selected, document.id] : selected.filter((id) => id !== document.id)).join(","))} />{document.name}
      </label>)}
    </fieldset>;
  }
  return <label className="grid min-w-0 gap-1.5 text-sm text-fg-2">{field.label}
    {field.kind === "enum" ? <select className={ADMISSIONS_INPUT} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Не проверено / не заполнено</option>{field.options?.map((option) => <option key={option} value={option}>{admissionsValueLabel(option)}</option>)}
    </select> : field.kind === "date" ? <input type="date" className={ADMISSIONS_INPUT} value={value} onChange={(event) => onChange(event.target.value)} />
      : <textarea className={ADMISSIONS_INPUT} rows={2} maxLength={2000} value={value} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}

/** One active editor per route: refreshing one command cannot erase another draft. */
export function AdmissionsRouteEditor({ title, initialValues, fields, documents = [], makeCommand, onClose, onSaved, extra }: {
  title: string; initialValues: Record<string, string>; fields: readonly AdmissionsField[];
  documents?: readonly { id: string; name: string }[];
  makeCommand: (values: Record<string, string>, requestId: string) => AdmissionsCommand;
  onClose: () => void; onSaved: (confirmed: boolean) => void;
  extra?: (values: Record<string, string>, change: (key: string, value: string) => void) => React.ReactNode;
}) {
  const [initial] = useState(initialValues);
  const [values, setValues] = useState(initialValues);
  // A background RSC refresh must not silently rebase a dirty full snapshot
  // onto a newer revision. The original version stays bound to this editor.
  const [buildCommand] = useState(() => makeCommand);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AdmissionsCommandResult | null>(null);
  const [notice, setNotice] = useState("");
  const pending = useRef<AdmissionsCommand | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const blocked = useRef(false);
  useEffect(() => { blocked.current = dirty || busy || pending.current !== null; }, [dirty, busy, result]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => installAssessmentExitGuard({ blocked: () => blocked.current, notify: () => setNotice("Сначала сохраните изменения или отмените редактирование.") }), []);
  const uncertain = result?.ok === false && result.code === "unavailable";
  const confirmed = result?.ok === true;
  const stale = result?.ok === false && ["stale", "denied", "request_conflict"].includes(result.code);
  function change(key: string, value: string) { setValues((current) => ({ ...current, [key]: value })); setResult(null); setNotice(""); }
  async function save() {
    if (busy || stale || confirmed) return;
    const command = pending.current ?? buildCommand(values, crypto.randomUUID());
    pending.current = command; blocked.current = true; setBusy(true); setNotice("");
    let response: AdmissionsCommandResult;
    try { response = await executeAdmissionsCommandAction(command); }
    catch { response = { ok: false, code: "unavailable", message: "Не удалось подтвердить сохранение. Повторите тот же запрос." }; }
    setBusy(false); setResult(response);
    if (response.ok) { pending.current = null; blocked.current = false; onSaved(true); }
    else if (response.code !== "unavailable") pending.current = null;
  }
  return <section className="rounded-card border-2 border-accent bg-surface p-4 sm:p-5" aria-label={title}>
    <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold text-fg">{title}</h3>
    <p className="mt-2 text-sm leading-6 text-fg-2">Записывайте подтверждённые факты. Поле с основанием — ссылка или описание подтверждения, а не отметка об автоматической проверке.</p>
    <fieldset disabled={busy || uncertain || stale || confirmed} onChangeCapture={() => { blocked.current = true; }} className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
      <legend className="sr-only">Изменения</legend>
      {fields.map((field) => <AdmissionsFieldInput key={field.key} field={field} value={values[field.key] ?? ""} onChange={(value) => change(field.key, value)} documents={documents} />)}
      {extra?.(values, change)}
    </fieldset>
    {notice ? <p role="status" className="mt-4 text-sm text-fg-2">{notice}</p> : null}
    {result && !result.ok ? <p role="alert" className="mt-4 text-sm text-danger">{result.message}</p> : null}
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={busy || stale || confirmed} className="min-h-11 rounded-nav bg-accent px-5 text-sm font-semibold text-on-accent disabled:opacity-50" onClick={() => void save()}>{busy ? "Сохраняем…" : confirmed ? "Сохранено" : uncertain ? "Повторить тот же запрос" : "Сохранить"}</button>
      <button type="button" disabled={busy || uncertain || confirmed} className={ADMISSIONS_BUTTON} onClick={() => {
        if (dirty && !window.confirm("Отменить несохранённые изменения? Сохранённые данные дела останутся прежними.")) return;
        blocked.current = false; onClose();
      }}>Отмена</button>
      {stale ? <button type="button" className={ADMISSIONS_BUTTON} onClick={() => {
        if (dirty && !window.confirm("Загрузить актуальное дело? Несохранённый ввод в этой форме будет отменён.")) return;
        blocked.current = false; onSaved(false);
      }}>Загрузить актуальные данные</button> : null}
    </div>
  </section>;
}
