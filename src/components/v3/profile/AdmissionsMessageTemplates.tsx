"use client";

import { useState } from "react";
import type { AdmissionsPlaybook } from "@/lib/platform-admissions-playbook-contract";

export function AdmissionsMessageTemplates({ playbook, stage, studentName }: { playbook: AdmissionsPlaybook; stage: string; studentName: string }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = playbook.content.messages.find((item) => item.id === selectedId);
  return <details className="rounded-card border border-border bg-surface p-4 sm:p-5">
    <summary className="min-h-11 cursor-pointer text-base font-semibold text-fg">Подготовить сообщение</summary>
    <p className="mt-2 text-sm leading-6 text-fg-2">Проверьте детали и скопируйте текст. Приложение не отправляет сообщения автоматически.</p>
    <label className="mt-4 grid gap-2 text-sm font-medium text-fg">Шаблон сообщения
      <select className="min-h-11 min-w-0 rounded-nav border border-control-edge bg-surface px-3 text-fg" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        <option value="">Выберите подходящий шаблон</option>
        {playbook.content.stages.map((item) => <optgroup key={item.key} label={`${item.title}${stage === item.key ? " — текущий этап" : ""}`}>
          {playbook.content.messages.filter((message) => message.stageKey === item.key).map((message) => <option key={message.id} value={message.id}>{message.title} · {message.locale.toUpperCase()}</option>)}
        </optgroup>)}
      </select>
    </label>
    {selected ? <MessageEditor key={selected.id} template={selected} studentName={studentName} /> : null}
  </details>;
}

function MessageEditor({ template, studentName }: { template: AdmissionsPlaybook["content"]["messages"][number]; studentName: string }) {
  const [values, setValues] = useState<Record<string, string>>({ student_name: studentName });
  const [edited, setEdited] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const prepared = template.body.replace(/\{\{([a-z0-9_]+)\}\}/g, (match, key: string) => values[key]?.trim() || match);
  const body = edited ?? prepared;
  const incomplete = /\{\{[^}]+\}\}/.test(body);
  const audience = { student: "студент", referral: "агентство — источник клиента", partner: "партнёр по подаче", university: "университет" };
  return <div className="mt-4 space-y-4">
    <p className="text-sm leading-6 text-fg-2">Кому: {audience[template.audience]}. {template.whenToUse}</p>
    {edited === null ? <div className="grid gap-3 sm:grid-cols-2">{template.placeholders.map((field) => <label key={field.key} className="grid gap-1.5 text-sm text-fg-2">{field.label}
      <input className="min-h-11 min-w-0 rounded-nav border border-control-edge bg-surface px-3 text-fg" value={values[field.key] ?? ""} maxLength={1000} onChange={(event) => { setValues({ ...values, [field.key]: event.target.value }); setStatus(""); }} />
    </label>)}</div> : <p className="text-sm text-fg-2">Вы редактируете готовый текст. Изменения не сохраняются в деле.</p>}
    <label className="grid gap-2 text-sm font-medium text-fg">Текст для проверки
      <textarea className="min-h-60 min-w-0 rounded-nav border border-control-edge bg-surface p-3 text-sm leading-6 text-fg" value={body} maxLength={20000} onChange={(event) => { setEdited(event.target.value); setStatus(""); }} />
    </label>
    {incomplete ? <p className="text-sm text-fg-2">Заполните все места в двойных фигурных скобках перед копированием.</p> : null}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={incomplete || !body.trim()} className="min-h-11 rounded-nav border border-control-edge px-4 text-sm font-semibold text-fg disabled:opacity-50" onClick={async () => {
        try { await navigator.clipboard.writeText(body); setStatus("Скопировано. Отправьте сообщение самостоятельно после проверки адресата."); }
        catch { setStatus("Не удалось скопировать автоматически. Выделите текст и скопируйте вручную."); }
      }}>Скопировать текст</button>
      {edited !== null ? <button type="button" className="min-h-11 px-3 text-sm text-fg-2 underline" onClick={() => { if (window.confirm("Вернуть шаблон? Ваши ручные изменения текста будут удалены.")) { setEdited(null); setStatus(""); } }}>Вернуть шаблон</button> : null}
      <p role="status" className="text-sm text-fg-2">{status}</p>
    </div>
  </div>;
}
