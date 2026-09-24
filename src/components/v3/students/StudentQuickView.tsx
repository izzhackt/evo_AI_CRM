"use client";

import Link from "next/link";
import { useId } from "react";

import type { CaseNextActionReceipt, StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";
import { admissionsPipelineStage, taskStatus } from "@/lib/v3/wording";

import { queueDue } from "../queue/due-bucket";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import { QueueDetailPanel } from "../queue/QueueDetailPanel";
import { NextStepEditor } from "./NextStepEditor";
import { studentsRowMeta } from "./StudentsQueueTable";
import { studentsDocumentsLine, type NextStepAccess, type StudentsOpenTasks } from "./students-queue-view";

const SECTION = "space-y-2 border-t border-border pt-4";
const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";
const TONE = { danger: "text-danger", warn: "text-warn", muted: "text-fg-2" } as const;
/** Сколько открытых задач показывает панель; остальные — в деле. */
export const QUICK_VIEW_TASKS = 5;

export type QuickViewLinks = Readonly<{
  close: string;
  /** Student 360 на «Обзоре» с возвратом в очередь. */
  case: string;
  documents: string;
  tasks: string;
  /** Глобальный диалог «Создать задачу» с выбранным делом; null — создавать нельзя. */
  createTask: string | null;
  task: (taskId: string) => string;
}>;

function Fact({ term, children }: Readonly<{ term: string; children: React.ReactNode }>) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 py-2">
      <dt className="t-caption text-fg-2">{term}</dt>
      <dd className="min-w-0 t-body-compact text-fg">{children}</dd>
    </div>
  );
}

/**
 * «Быстрый просмотр» дела в правой панели очереди: факты дела, редактор
 * «Следующего шага», открытые задачи и строка документов. Всё правится
 * существующими командами; права проверяет сервер.
 */
export function StudentQuickView({
  row,
  today,
  now,
  access,
  tasks,
  links,
  requestId,
  onSaved,
}: Readonly<{
  row: StudentCaseQueueRow;
  today: string;
  now: Date;
  access: NextStepAccess;
  tasks: StudentsOpenTasks | null;
  links: QuickViewLinks;
  requestId: string;
  onSaved: (receipt: CaseNextActionReceipt) => void;
}>) {
  const headingId = useId();
  const stepHeadingId = `${headingId}-step`;
  const stage = admissionsPipelineStage(row.pipelineStage) ?? row.pipelineStage;
  const awaiting = row.attentionFlags.includes("awaiting_ack");
  const documents = studentsDocumentsLine(row.documents);
  const due = row.nextAction && row.nextActionDueOn ? queueDue({ dueOn: row.nextActionDueOn, dueAt: null }, now, row.state !== "closed") : null;
  const openTasks = tasks?.kind === "ready" ? tasks.tasks : [];

  return (
    <QueueDetailPanel closeHref={links.close} backLabel="К студентам" headingId={headingId}>
      <header className="space-y-1 xl:pe-10">
        <h2 id={headingId} tabIndex={-1} data-queue-heading="" className="t-record-title break-words text-fg">{row.studentDisplayName}</h2>
        <p className="t-meta text-fg-2">{studentsRowMeta(row)}</p>
      </header>
      <div className="mt-3">
        <Link href={links.case} className={QUEUE_SECONDARY}>Открыть дело</Link>
      </div>

      <dl className="mt-4 divide-y divide-border border-t border-border">
        <Fact term="Этап">{stage}</Fact>
        <Fact term="Куратор">
          {row.currentCuratorDisplayName ?? (row.attentionFlags.includes("needs_curator") ? <span className="font-medium text-danger">нужен куратор</span> : <span className="text-fg-3">не назначен</span>)}
          {awaiting ? <span className="block font-medium text-warn">ждёт принятия</span> : null}
        </Fact>
        {row.state !== "active" ? <Fact term="Состояние">{row.state === "closed" ? "Дело закрыто" : "Ожидает начала"}</Fact> : null}
      </dl>

      <section aria-labelledby={stepHeadingId} className={`mt-2 ${SECTION}`}>
        <h3 id={stepHeadingId} className="t-item text-fg">Следующий шаг</h3>
        {access.kind === "edit" ? (
          <NextStepEditor key={row.studentCaseId} row={row} today={today} requestId={requestId} onSaved={onSaved} />
        ) : (
          <>
            {row.nextAction ? (
              <p className="t-body-compact break-words text-fg">
                {row.nextAction}
                {due ? <> · <time dateTime={due.dateTime} className={`font-mono tabular-nums ${due.overdue ? "text-danger" : ""}`}>{due.text}</time>{due.word ? <span className={due.overdue ? "text-danger" : "text-fg-2"}> {due.word}</span> : null}</> : null}
              </p>
            ) : <p className="t-body-compact text-fg-3">Шаг не задан</p>}
            {access.reason ? <p className="t-body-compact text-fg-2">{access.reason}</p> : null}
          </>
        )}
      </section>

      <section aria-label="Задачи дела" className={`mt-4 ${SECTION}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="t-item text-fg">Задачи</h3>
          {links.createTask ? <Link href={links.createTask} className={LINK}>+ Задача</Link> : null}
        </div>
        {tasks === null || tasks.kind === "unavailable" ? (
          <p className="t-body-compact text-fg-2">
            Задачи сейчас недоступны. <Link href={links.tasks} className="underline underline-offset-4">Задачи в деле</Link>
          </p>
        ) : openTasks.length === 0 ? (
          <p className="t-body-compact text-fg-3">Открытых задач нет.</p>
        ) : (
          <ul className="divide-y divide-border">
            {openTasks.slice(0, QUICK_VIEW_TASKS).map((task) => {
              const taskDue = queueDue({ dueOn: task.dueOn, dueAt: task.dueAt }, now);
              const word = task.status === "blocked" ? taskStatus(task.status) : null;
              return (
                <li key={task.id} className="py-2">
                  <Link href={links.task(task.id)} className="block break-words t-body-compact text-fg underline-offset-4 hover:underline">{task.title}</Link>
                  <p className="t-meta text-fg-2">
                    {taskDue ? <><time dateTime={taskDue.dateTime} className={`font-mono tabular-nums ${taskDue.overdue ? "text-danger" : ""}`}>{taskDue.text}</time>{taskDue.word ? <span className={taskDue.overdue ? "text-danger" : undefined}> {taskDue.word}</span> : null}</> : "без срока"}
                    {word ? <span className="text-warn"> · {word}</span> : null}
                    <span> · исп. {task.assigneeDisplayName}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {openTasks.length > QUICK_VIEW_TASKS ? <Link href={links.tasks} className={LINK}>Все задачи дела · {openTasks.length}</Link> : null}
      </section>

      <section aria-label="Документы дела" className={`mt-4 ${SECTION}`}>
        <h3 className="t-item text-fg">Документы</h3>
        {documents ? (
          <p className="t-body-compact text-fg">
            {documents.summary}
            {documents.parts.map((part) => <span key={part.key}><span className="text-fg-3"> · </span><span className={`font-medium ${TONE[part.tone]}`}>{part.text}</span></span>)}
          </p>
        ) : <p className="t-body-compact text-fg-3">Нет доступа к документам этого дела.</p>}
        <Link href={links.documents} className={LINK}>Документы дела</Link>
      </section>
    </QueueDetailPanel>
  );
}

/** Панель для строки, которой нет на открытой странице списка (ссылка на другую страницу). */
export function StudentQuickViewMissing({ closeHref, caseHref }: Readonly<{ closeHref: string; caseHref: string }>) {
  const headingId = useId();
  return (
    <QueueDetailPanel closeHref={closeHref} backLabel="К студентам" headingId={headingId}>
      <h2 id={headingId} tabIndex={-1} data-queue-heading="" className="t-section text-fg xl:pe-10">Дела нет на этой странице списка</h2>
      <p className="mt-2 t-body-compact text-fg-2">Оно в другом виде или на другой странице, либо недоступно вам.</p>
      <div className="mt-3"><Link href={caseHref} className={QUEUE_SECONDARY}>Открыть дело</Link></div>
    </QueueDetailPanel>
  );
}
