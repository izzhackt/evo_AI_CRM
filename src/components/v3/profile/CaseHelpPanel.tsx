"use client";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { loadCaseHelpAction } from "@/lib/platform-admissions-support-actions";
import type { CaseHelpPage } from "@/lib/platform-admissions-support-contract";
import { AnswerCaseHelpForm, CreateCaseHelpForm } from "./CaseOperationsForms";

/**
 * Обращения дела. Студент (`student`, кабинет — свой облик) видит «Мои обращения и ответы» в рамке;
 * сотрудник — «Обращения студента» строкой-раскрытием, как остальные группы «Обзора»: со счётом в строке,
 * без своей рамки на плоской странице. Файл общий с кабинетом, поэтому роли `t-*` здесь не используются.
 */
export function CaseHelpPanel({ initialPage, student }: { initialPage: CaseHelpPage; student: boolean }) {
  const [older, setOlder] = useState<CaseHelpPage | null>(null); const [error, setError] = useState(""); const [pending, transition] = useTransition();
  const page = older ?? initialPage;
  const openCount = page.items.filter(item => item.status === "open").length;
  const items = !page.items.length ? <p className="mt-3 text-sm text-fg-3">Обращений пока нет.</p> : <ul className="mt-3 divide-y divide-border">{page.items.map(request => <li key={request.id} className="py-4"><h4 className="break-words font-semibold text-fg">{request.subject}</h4>
        <p className="mt-1 text-xs text-fg-3">{request.status === "open" ? "Ожидает ответа" : "Ответ получен"} · {new Date(request.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" })}</p>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-fg">{request.body}</p>
        {request.answer ? <div className="mt-3 border-s-2 border-accent ps-3"><p className="text-xs font-semibold text-fg-2">Ответ EVO</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-fg">{request.answer}</p></div> : null}
        {!student ? <AnswerCaseHelpForm caseId={page.caseId} request={request} onSaved={() => setOlder(null)} /> : null}
      </li>)}</ul>;
  const more = <>
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
    <div className="mt-3 flex gap-3">{older ? <button type="button" className="min-h-11 text-sm font-medium text-fg-2 underline underline-offset-4 hover:text-fg" onClick={() => { setOlder(null); setError(""); }}>Последние обращения</button> : null}
      {page.nextCursor ? <button type="button" disabled={pending} className="min-h-11 text-sm font-medium text-fg-2 underline underline-offset-4 hover:text-fg" onClick={() => transition(async () => {
        setError(""); const result = await loadCaseHelpAction(page.caseId, page.nextCursor, student);
        if (result.ok) setOlder(result.page); else setError("Не удалось прочитать обращения. Проверьте доступ и повторите.");
      })}>{pending ? "Загружаем…" : "Более ранние обращения"}</button> : null}</div>
  </>;
  if (!student) {
    return <section id="case-help" aria-label="Обращения студента">
      <details className="group border-y border-border" open={openCount > 0}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-nav py-1.5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
            <span className="text-sm font-semibold text-fg">Обращения студента</span>
            <span className="text-xs text-fg-2">{openCount > 0 ? `ждут ответа: ${openCount}` : page.items.length ? `${page.items.length}` : "нет"}</span>
          </span>
          <Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="pb-4">{items}{more}</div>
      </details>
    </section>;
  }
  return <section className="space-y-4" id="case-help" aria-label="Помощь по поступлению">
    <CreateCaseHelpForm onSaved={() => setOlder(null)} />
    <details className="rounded-card border border-border bg-surface p-4 sm:p-5" open={openCount > 0}><summary className="min-h-11 cursor-pointer font-semibold text-fg">Мои обращения и ответы</summary>
      {items}{more}
    </details>
  </section>;
}
