"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { StudentPortalAssessmentPreview } from "@/lib/server/student-portal-assessment-preview-content";
import { AssessmentQuestion } from "./AssessmentQuestion";

const CONTROL = "inline-flex min-h-11 items-center justify-center rounded-nav border px-5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON = `${CONTROL} border-control-edge text-fg hover:bg-surface-2`;
const PRIMARY = `${CONTROL} border-transparent bg-accent text-on-accent hover:brightness-95`;

export function AssessmentPreviewRunner({ content }: { content: StudentPortalAssessmentPreview }) {
  const [started, setStarted] = useState(false);
  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const pageSize = content.instrumentKey === "english36" ? 1 : 4;
  const total = content.questions.length;
  const pageCount = Math.ceil(total / pageSize);
  const count = Object.keys(answers).length;
  const finished = page === pageCount;

  function focusQuestion() {
    requestAnimationFrame(() => {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }

  function goTo(nextPage: number) {
    setPage(nextPage);
    focusQuestion();
  }

  return <div className="mx-auto max-w-3xl space-y-5" data-testid="assessment-preview">
    <div className="rounded-card border border-border bg-surface-2 px-5 py-4 text-sm leading-6 text-fg-2">
      <p className="font-medium text-fg">Просмотр содержания · версия {content.version}</p>
      <p className="mt-1">Ответы не сохраняются. Обновление страницы или выход очистит выбор. Попытка не создаётся, результат не рассчитывается.</p>
    </div>
    {!started ? <section className="space-y-6 rounded-card border border-border bg-surface p-5 sm:p-7">
      <div><h2 className="text-xl font-semibold text-fg">Инструкции для студента</h2><p className="mt-2 text-sm leading-6 text-fg-3">Ниже — действующий текст для настоящего прохождения. Сохранение и результат в предпросмотре отключены.</p><ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-fg-2">{content.instructions.map(instruction => <li key={instruction}>{instruction}</li>)}</ul></div>
      <p className="text-sm leading-6 text-fg-2">{total} заданий. Можно посмотреть любые вопросы и вернуться назад.</p>
      <details><summary className="min-h-11 cursor-pointer font-medium text-fg">Что важно знать о результате</summary><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-fg-2">{content.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul></details>
      <button type="button" className={PRIMARY} onClick={() => { setStarted(true); focusQuestion(); }}>Начать просмотр</button>
    </section> : <>
      <div className="rounded-card border border-border bg-surface px-5 py-4">
        <p role="status" aria-live="polite" className="text-sm font-medium text-fg">Выбрано ответов: {count} из {total} · только в этой странице</p>
        <progress value={count} max={total} aria-label={`Выбрано ответов: ${count} из ${total}`} className="mt-3 h-2 w-full accent-accent" />
      </div>
      <section className="rounded-card border border-border bg-surface p-5 sm:p-7">
        <h2 ref={heading} tabIndex={-1} className="scroll-mt-28 text-lg font-semibold text-fg outline-none">{finished ? "Просмотр завершён" : content.instrumentKey === "english36" ? `Задание ${page + 1} из ${total}` : `Часть ${page + 1} из ${pageCount}`}</h2>
        {finished ? <div className="mt-5 space-y-5 text-sm leading-6 text-fg-2"><p>Вы посмотрели все страницы. В этом режиме нет оценки и личной истории; можно вернуться к вопросам или очистить выбранные ответы.</p><button type="button" className={BUTTON} onClick={() => { setAnswers({}); goTo(0); }}>Сбросить просмотр</button></div> : <div className="mt-6 space-y-8">{content.questions.slice(page * pageSize, (page + 1) * pageSize).map((question, offset) => <AssessmentQuestion key={question.id} question={question} instrumentKey={content.instrumentKey} answer={answers[question.id]} number={page * pageSize + offset + 1} onSelect={(id, value) => setAnswers(current => ({ ...current, [id]: value }))} />)}</div>}
        <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-border pt-5">
          <button type="button" className={BUTTON} disabled={page === 0} onClick={() => goTo(page - 1)}>Назад</button>
          {!finished ? <button type="button" className={PRIMARY} onClick={() => goTo(page + 1)}>{page + 1 === pageCount ? "Завершить просмотр" : "Далее"}</button> : null}
        </div>
      </section>
    </>}
    <Link href="/preview/student/tests" className={BUTTON}>К списку тестов</Link>
  </div>;
}
