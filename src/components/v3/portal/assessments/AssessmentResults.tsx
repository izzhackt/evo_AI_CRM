"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { AssessmentAttempt, AssessmentProfession, OrvisScale } from "@/lib/student-assessment-contract";

const SCALE_LABELS: Record<OrvisScale, string> = { leadership: "Лидерство", organization: "Организация", altruism: "Помощь людям", creativity: "Творчество", analysis: "Анализ", production: "Практическая работа", adventure: "Динамичная работа", erudition: "Изучение и знания" };
const TOPIC_LABELS: Record<string, string> = { grammar: "Грамматика", vocabulary: "Слова в контексте", reading: "Чтение" };

function ProfessionCard({ profession }: { profession: AssessmentProfession }) {
  return <details className="rounded-card border border-border bg-surface p-5">
    <summary className="min-h-11 cursor-pointer text-base font-semibold text-fg">{profession.title}</summary>
    <div className="mt-3 space-y-4 text-sm leading-6 text-fg-2">
      <p>{profession.summary}</p>
      <div><h4 className="font-semibold text-fg">Что делают в течение дня</h4><ul className="mt-1 list-disc space-y-1 pl-5">{profession.tasks.map(item => <li key={item}>{item}</li>)}</ul></div>
      <p><strong className="font-semibold text-fg">Что развивать: </strong>{profession.skills.join(" · ")}</p>
      <p><strong className="font-semibold text-fg">Что изучать: </strong>{profession.studyDirections.join(" · ")}</p>
      {profession.careerPath?.length ? <p><strong className="font-semibold text-fg">Возможное развитие: </strong>{profession.careerPath.join(" → ")}</p> : null}
      <p className="rounded-nav bg-surface-2 p-4"><strong className="font-semibold text-fg">Попробуйте: </strong>{profession.tryActivity}</p>
      <p className="text-xs leading-5 text-fg-3">{profession.editorialNote}</p>
      <p className="text-xs leading-5 text-fg-3">Адаптация EVO по <a className="underline underline-offset-4" href={profession.source.url} target="_blank" rel="noopener noreferrer">профилю O*NET® {profession.source.occupationId}</a>, {profession.source.version}; <a className="underline underline-offset-4" href={profession.source.licenseUrl} target="_blank" rel="noopener noreferrer">{profession.source.license}</a>. Источник проверен {profession.source.retrievedOn}. Описание профессии относится к контексту США; программы вузов могут отличаться.</p>
    </div>
  </details>;
}

export function AssessmentResults({ attempt }: { attempt: AssessmentAttempt }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const result = attempt.result;
  if (!result) return null;
  const english = result.english;
  const orvis = result.orvis;
  const scales = orvis ? [...orvis.scales].sort((a, b) => b.mean - a.mean) : [];
  const preferred = result.metadata.professions?.filter(p => p.scaleIds.some(s => orvis?.topScales.includes(s))) ?? [];
  const other = result.metadata.professions?.filter(p => !preferred.includes(p)) ?? [];
  return <div className="space-y-7" data-testid="assessment-results">
    <section className="rounded-card border border-border bg-surface p-5 sm:p-7">
      <p className="text-sm font-medium text-fg-3">Завершён · версия {result.version}</p>
      <h2 ref={title} tabIndex={-1} className="mt-2 text-2xl font-semibold text-fg outline-none">{english ? `${english.correctCount} из ${english.totalCount}` : "Ваша карта интересов"}</h2>
      {english?.band ? <p className="mt-2 text-base font-medium text-fg">{result.metadata.bands?.find(b => b.id === english.band)?.label ?? "Результат на этом наборе заданий"}</p> : null}
      <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-2">{english ? "Это результат этого набора заданий, не сертификат уровня языка. Ниже — темы для дальнейшей практики. Аудирование, разговорная речь и письмо не оценивались." : "Более высокий средний ответ показывает больший интерес к занятиям этой группы. Это не оценка способностей и не предписание выбрать одну профессию."}</p>
      <p className="mt-3 text-xs leading-5 text-fg-3">Результат сохранён. Он доступен только в вашем кабинете и не назначает куратору задачи.</p>
    </section>

    {english ? <>
      <section aria-labelledby="english-topics"><h2 id="english-topics" className="text-xl font-semibold text-fg">Сильные стороны и темы для практики</h2>
        <div className="mt-4 divide-y divide-border rounded-card border border-border bg-surface px-5">
          {english.topics.map(topic => <div key={topic.topic} className="py-5">
            <div className="flex items-baseline justify-between gap-3"><h3 className="font-medium text-fg">{TOPIC_LABELS[topic.topic] ?? topic.topic}</h3><span className="shrink-0 text-sm text-fg-2">{topic.correctCount} / {topic.totalCount}</span></div>
            <meter className="mt-3 h-3 w-full accent-accent" min={0} max={topic.totalCount} value={topic.correctCount} aria-label={`${TOPIC_LABELS[topic.topic] ?? topic.topic}: ${topic.correctCount} из ${topic.totalCount}`} />
            <p className="mt-2 text-sm text-fg-3">{topic.totalCount < 4 ? "Мало заданий для уверенного вывода — используйте разбор ниже." : topic.correctCount / topic.totalCount >= .75 ? "В этом наборе большинство заданий выполнены верно. Закрепляйте навык на новых материалах." : "Начните с разбора ошибок ниже и потренируйтесь на похожих новых заданиях."}</p>
            <p className="mt-2 text-sm leading-6 text-fg-2">{result.metadata.recommendations?.[topic.topic as "grammar" | "vocabulary" | "reading"]}</p>
          </div>)}
        </div>
      </section>
      <section aria-labelledby="english-review"><h2 id="english-review" className="text-xl font-semibold text-fg">Разбор заданий</h2><p className="mt-2 text-sm text-fg-3">Повтор этого же теста после разбора не является независимой проверкой уровня.</p>
        <div className="mt-4 space-y-3">{english.feedback.map((feedback, index) => {
          const question = attempt.questions.find(q => q.id === feedback.questionId);
          const skill = result.metadata.blueprint?.find(b => b.questionId === feedback.questionId)?.skill;
          const topicLabel = (skill && result.metadata.skillLabels?.[skill]) || TOPIC_LABELS[feedback.topic] || "Разбор задания";
          return <details key={feedback.questionId} className="rounded-card border border-border bg-surface p-4">
            <summary className="min-h-11 cursor-pointer text-sm font-medium text-fg">{index + 1}. {feedback.correct ? "Верно" : "Нужно разобрать"} — {topicLabel}</summary>
            <div className="mt-3 space-y-3 text-sm leading-6 text-fg-2">{question?.passage ? <p lang="en" className="whitespace-pre-line border-l-2 border-border pl-4">{question.passage}</p> : null}<p lang="en" className="font-medium text-fg">{question?.prompt}</p><p>Ваш ответ: <span lang="en">{question?.options.find(o => o.id === feedback.selectedOptionId)?.label}</span></p><p>Правильный ответ: <span lang="en">{question?.options.find(o => o.id === feedback.correctOptionId)?.label}</span></p><p>{feedback.explanation}</p></div>
          </details>;
        })}</div>
      </section>
    </> : null}

    {orvis ? <>
      <section aria-labelledby="career-scales"><h2 id="career-scales" className="text-xl font-semibold text-fg">Интересы по восьми направлениям</h2><p className="mt-2 text-sm leading-6 text-fg-3">Средний ответ от 1 до 5. Это не процентили и не сравнение с другими студентами. Близкие значения не стоит считать существенно разными.</p>
        <div className="mt-4 divide-y divide-border rounded-card border border-border bg-surface px-5">{scales.map(s => <div key={s.scale} className="py-4"><div className="flex justify-between gap-3"><h3 className="font-medium text-fg">{result.metadata.scales?.find(m => m.id === s.scale)?.label ?? SCALE_LABELS[s.scale]}</h3><span className="shrink-0 text-sm text-fg-2">{s.mean.toFixed(2)} / 5</span></div><meter className="mt-2 h-3 w-full accent-accent" min={1} max={5} value={s.mean} aria-label={`${SCALE_LABELS[s.scale]}: ${s.mean.toFixed(2)} из 5`} /><p className="mt-2 text-sm leading-6 text-fg-3">{result.metadata.scales?.find(m => m.id === s.scale)?.description}</p></div>)}</div>
      </section>
      <section aria-labelledby="career-explore"><h2 id="career-explore" className="text-xl font-semibold text-fg">Профессии, которые можно исследовать</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-fg-3">Редакционные примеры EVO по вашим интересам, не научно подтверждённый прогноз соответствия. Начните с небольшого пробного задания и посмотрите учебные планы вузов.</p>
        {result.metadata.professionAttribution ? <p className="mt-3 max-w-3xl text-sm leading-6 text-fg-3">{result.metadata.professionAttribution}</p> : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2">{preferred.map(p => <ProfessionCard key={p.id} profession={p} />)}</div>
        {other.length ? <details className="mt-5"><summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-fg underline underline-offset-4">Посмотреть остальные направления</summary><div className="mt-4 grid gap-4 md:grid-cols-2">{other.map(p => <ProfessionCard key={p.id} profession={p} />)}</div></details> : null}
      </section>
    </> : null}
    <details className="rounded-card border border-border bg-surface p-5"><summary className="min-h-11 cursor-pointer font-medium text-fg">Как читать результат и его ограничения</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-fg-2">{result.metadata.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
    <Link href="/portal/tests" className="inline-flex min-h-11 items-center rounded-nav border border-control-edge px-5 text-sm font-medium text-fg">Вернуться к тестам</Link>
  </div>;
}
