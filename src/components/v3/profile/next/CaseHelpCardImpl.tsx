"use client";

import { useState, useTransition } from "react";

import { loadCaseHelpAction } from "@/lib/platform-admissions-support-actions";
import type { CaseHelpPage } from "@/lib/platform-admissions-support-contract";

import { AnswerCaseHelpForm } from "../CaseOperationsForms";
import { NamedCard } from "./NamedCard";

/**
 * «Обращения студента» карточкой «Нового вида» (сотрудник): счёт и «ждут ответа» у заголовка, обращения без своей шапки;
 * без ожидающих ответа список свёрнут. Те же чтение, форма ответа и «Более ранние обращения», что у `CaseHelpPanel`
 * прежнего вида; свой файл — чтобы общий с кабинетом студента `CaseHelpPanel` не тянул в кабинет карточку набора виджетов
 * (Radix Popover и склейку классов нового вида: +33 КБ gzip на главной кабинета). Подключает `CaseHelpCard`, подгружая по требованию.
 */
export function CaseHelpCardImpl({ initialPage }: Readonly<{ initialPage: CaseHelpPage }>) {
  const [older, setOlder] = useState<CaseHelpPage | null>(null);
  const [error, setError] = useState("");
  const [pending, transition] = useTransition();
  const page = older ?? initialPage;
  const openCount = page.items.filter((item) => item.status === "open").length;
  // Заголовок обращения идёт сразу под заголовком карточки (h2): уровень h3, а не h4 (порядок заголовков).
  const items = !page.items.length ? <p className="text-sm text-fg-3">Обращений пока нет.</p> : (
    <ul className="divide-y divide-border">
      {page.items.map((request) => (
        <li key={request.id} className="py-4 first:pt-0">
          <h3 className="break-words font-semibold text-fg">{request.subject}</h3>
          <p className="mt-1 text-xs text-fg-3">{request.status === "open" ? "Ожидает ответа" : "Ответ получен"} · {new Date(request.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" })}</p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-fg">{request.body}</p>
          {request.answer ? <div className="mt-3 border-s-2 border-accent ps-3"><p className="text-xs font-semibold text-fg-2">Ответ EVO</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-fg">{request.answer}</p></div> : null}
          <AnswerCaseHelpForm caseId={page.caseId} request={request} onSaved={() => setOlder(null)} />
        </li>
      ))}
    </ul>
  );
  const more = (
    <>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex gap-3">
        {older ? <button type="button" className="min-h-11 text-sm font-medium text-fg-2 underline underline-offset-4 hover:text-fg" onClick={() => { setOlder(null); setError(""); }}>Последние обращения</button> : null}
        {page.nextCursor ? <button type="button" disabled={pending} className="min-h-11 text-sm font-medium text-fg-2 underline underline-offset-4 hover:text-fg" onClick={() => transition(async () => {
          setError("");
          const result = await loadCaseHelpAction(page.caseId, page.nextCursor, false);
          if (result.ok) setOlder(result.page); else setError("Не удалось прочитать обращения. Проверьте доступ и повторите.");
        })}>{pending ? "Загружаем…" : "Более ранние обращения"}</button> : null}
      </div>
    </>
  );
  return (
    <NamedCard
      title="Обращения студента" id="case-help" testId="v3-case-help" count={page.items.length || null}
      actions={openCount > 0 ? <span className="text-xs font-medium text-warn">ждут ответа: {openCount}</span> : null}
    >
      {openCount > 0 || !page.items.length ? <>{items}{more}</> : (
        <details>
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center text-sm font-medium text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden">Показать обращения</summary>
          {items}{more}
        </details>
      )}
    </NamedCard>
  );
}
