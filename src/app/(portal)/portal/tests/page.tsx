import type { Metadata } from "next";
import Link from "next/link";
import { PortalEmptyState, PortalPage } from "@/components/v3/portal/PortalPage";
import { assessmentPath } from "@/lib/student-assessment-contract";
import { readStudentAssessments } from "@/lib/v3/student-assessment-source";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Тесты — EVO Admissions" };

export default async function StudentTestsPage() {
  const catalog = await readStudentAssessments();
  return <PortalPage title="Тесты" description="Узнайте, что стоит подтянуть в английском и какие занятия вам интересны. Проходите в своём темпе — результаты остаются в вашем кабинете.">
    {catalog.instruments.length === 0 ? <PortalEmptyState title="Тесты готовятся" description="Когда проверенные задания будут опубликованы, они появятся здесь." /> : <div className="grid max-w-4xl gap-5 md:grid-cols-2">{catalog.instruments.map(instrument => {
      const draft = catalog.attempts.find(a => a.attemptId === instrument.draftAttemptId);
      const current = instrument.draftAttemptId ?? instrument.latestCompletedAttemptId;
      const href = `${assessmentPath(instrument.instrumentKey)}${current ? `?attempt=${current}` : ""}`;
      return <section key={instrument.instrumentKey} className="flex flex-col rounded-card border border-border bg-surface p-5 sm:p-6">
        <p className="text-xs font-medium text-fg-3">{draft ? `В процессе · ${draft.answeredCount} из ${draft.questionCount}` : instrument.latestCompletedAttemptId ? "Завершён" : "Не начат"}</p>
        <h2 className="mt-3 text-xl font-semibold text-fg">{instrument.metadata.title}</h2><p className="mt-3 text-sm leading-6 text-fg-2">{instrument.metadata.description}</p>
        <p className="mt-4 text-xs leading-5 text-fg-3">{instrument.questionCount} заданий · можно прерваться</p>
        <Link href={href} className="mt-6 inline-flex min-h-11 items-center justify-center self-start rounded-nav bg-accent px-5 py-2 text-sm font-medium text-on-accent">{draft ? "Продолжить" : instrument.latestCompletedAttemptId ? "Открыть результат" : "Начать"}</Link>
        {instrument.latestCompletedAttemptId && !draft ? <Link href={`${assessmentPath(instrument.instrumentKey)}?new=1`} className="mt-3 inline-flex min-h-11 items-center self-start text-sm font-medium text-fg underline underline-offset-4">Пройти заново</Link> : null}
      </section>;
    })}</div>}
    <section className="mt-8 max-w-4xl"><h2 className="text-xl font-semibold text-fg">История</h2><p className="mt-2 text-sm leading-6 text-fg-3">Новая попытка не заменяет прошлый результат. Личные ответы не показываются сотрудникам EVO.</p>
      <ul className="mt-4 divide-y divide-border rounded-card border border-border bg-surface">{catalog.attempts.filter(a => a.status === "completed").map(a => <li key={a.attemptId}><Link href={`${assessmentPath(a.instrumentKey)}?attempt=${a.attemptId}`} className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-fg"><span>{a.instrumentKey === "english36" ? "Английский" : "Профориентация"} · версия {a.version}</span><span className="text-fg-3">{a.completedAt ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(a.completedAt)) : ""} →</span></Link></li>)}{!catalog.attempts.some(a => a.status === "completed") ? <li className="p-5 text-sm text-fg-3">Здесь появятся завершённые попытки.</li> : null}</ul>
    </section>
  </PortalPage>;
}
