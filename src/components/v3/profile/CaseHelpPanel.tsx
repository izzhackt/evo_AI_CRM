"use client";
import { useState, useTransition } from "react";
import { loadCaseHelpAction } from "@/lib/platform-admissions-support-actions";
import type { CaseHelpPage } from "@/lib/platform-admissions-support-contract";
import { AnswerCaseHelpForm, CreateCaseHelpForm } from "./CaseOperationsForms";

export function CaseHelpPanel({ initialPage, student }: { initialPage: CaseHelpPage; student: boolean }) {
  const [older, setOlder] = useState<CaseHelpPage | null>(null); const [error, setError] = useState(""); const [pending, transition] = useTransition();
  const page = older ?? initialPage;
  return <section className="space-y-4" id="case-help" aria-label={student ? "Помощь по поступлению" : "Обращения студента"}>
    {student ? <CreateCaseHelpForm onSaved={() => setOlder(null)} /> : null}
    <details className="rounded-card border border-border bg-surface p-4 sm:p-5" open={page.items.some(item => item.status === "open")}><summary className="min-h-11 cursor-pointer font-semibold text-fg">{student ? "Мои обращения и ответы" : "Обращения студента"}</summary>
      {!page.items.length ? <p className="mt-3 text-sm text-fg-3">Обращений пока нет.</p> : <ul className="mt-3 divide-y divide-border">{page.items.map(request => <li key={request.id} className="py-4"><h4 className="break-words font-semibold text-fg">{request.subject}</h4>
        <p className="mt-1 text-xs text-fg-3">{request.status === "open" ? "Ожидает ответа" : "Ответ получен"} · {new Date(request.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" })}</p>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-fg">{request.body}</p>
        {request.answer ? <div className="mt-3 border-s-2 border-accent ps-3"><p className="text-xs font-semibold text-fg-2">Ответ EVO</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-fg">{request.answer}</p></div> : null}
        {!student ? <AnswerCaseHelpForm caseId={page.caseId} request={request} onSaved={() => setOlder(null)} /> : null}
      </li>)}</ul>}
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex gap-3">{older ? <button type="button" className="min-h-11 text-sm font-medium text-accent-text underline" onClick={() => { setOlder(null); setError(""); }}>Последние обращения</button> : null}
      {page.nextCursor ? <button type="button" disabled={pending} className="min-h-11 text-sm font-medium text-accent-text underline" onClick={() => transition(async () => {
        setError(""); const result = await loadCaseHelpAction(page.caseId, page.nextCursor, student);
        if (result.ok) setOlder(result.page); else setError("Не удалось прочитать обращения. Проверьте доступ и повторите.");
      })}>{pending ? "Загружаем…" : "Более ранние обращения"}</button> : null}</div>
    </details>
  </section>;
}
