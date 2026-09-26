"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import type { CaseNextActionReceipt, StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";
import { admissionsPipelineStage, taskStatus } from "@/lib/v3/wording";

import { DueWord } from "../blocks/DueWord";
import { Initials } from "../blocks/Initials";
import { isNextLook, type V3Look } from "../blocks/look";
import { ProgressBar } from "../blocks/ProgressBar";
import { StageTrack } from "../blocks/StageTrack";
import { StatusChip } from "../blocks/StatusChip";
import { dueWordOf, queueDue } from "../queue/due-bucket";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import { QueueDetailPanel } from "../queue/QueueDetailPanel";
import { ProfileHandoffAcknowledgement } from "../profile/ProfileSalesTransition";
import { NextStepEditor } from "./NextStepEditor";
import { studentsRowMeta } from "./StudentsQueueTable";
import { studentsDocumentsLine, type NextStepAccess, type StudentsHandoff, type StudentsOpenTasks } from "./students-queue-view";

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
  handoff = null,
  links,
  requestId,
  onSaved,
  look,
}: Readonly<{
  row: StudentCaseQueueRow;
  today: string;
  now: Date;
  access: NextStepAccess;
  tasks: StudentsOpenTasks | null;
  /** «Приём дела»: тот же блок, что в карточке дела; только текущему куратору, пока дело не принято. */
  handoff?: StudentsHandoff | null;
  links: QuickViewLinks;
  requestId: string;
  onSaved: (receipt: CaseNextActionReceipt) => void;
  /**
   * Новый облик (Э1.3–Э1.4): дорожка этапа, инициалы куратора, срок словом и
   * полоса документов «N из M принято» из прочитанных чисел чек-листа.
   */
  look?: V3Look;
}>) {
  const next = isNextLook(look);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepHeadingId = `${headingId}-step`;
  // Приём или отказ записан: перечитанный снимок больше не ждёт ответа, и блок уходит —
  // итог называет панель, фокус с исчезнувшей кнопки переходит на заголовок. Строка
  // панели может быть прежней (дело ушло из вида), поэтому «ждёт принятия» гаснет по ответу.
  const [answered, setAnswered] = useState<"accepted" | "declined" | null>(null);
  useEffect(() => {
    if (!answered || handoff) return;
    const active = document.activeElement;
    if (active === null || active === document.body) headingRef.current?.focus();
  }, [answered, handoff]);
  // Неизвестный этап не показывается ключом базы (CLAUDE.md).
  const stage = admissionsPipelineStage(row.pipelineStage);
  const awaiting = !answered && row.attentionFlags.includes("awaiting_ack");
  const documents = studentsDocumentsLine(row.documents);
  // Шаг ведётся только у дела в работе: у закрытого и ожидающего начала дата без «прошёл».
  const due = row.nextAction && row.nextActionDueOn ? queueDue({ dueOn: row.nextActionDueOn, dueAt: null }, now, row.state === "active") : null;
  const dueWord = next && due ? dueWordOf({ dueOn: row.nextActionDueOn, dueAt: null }, now, row.state === "active") : null;
  const openTasks = tasks?.kind === "ready" ? tasks.tasks : [];

  return (
    <QueueDetailPanel closeHref={links.close} backLabel="К студентам" headingId={headingId}>
      <header className="space-y-1 xl:pe-10">
        <h2 ref={headingRef} id={headingId} tabIndex={-1} data-queue-heading="" className="t-record-title break-words text-fg">{row.studentDisplayName}</h2>
        <p className="t-meta text-fg-2">{studentsRowMeta(row)}</p>
      </header>
      <div className="mt-3">
        <Link href={links.case} className={QUEUE_SECONDARY}>Открыть дело</Link>
      </div>
      {/* Принять дело — главное действие куратора по переданному делу: первым под шапкой. */}
      {handoff ? (
        <div className="mt-4" data-testid="v3-students-panel-handoff">
          <ProfileHandoffAcknowledgement snapshot={handoff} onSaved={(decision) => setAnswered(decision === "clarification_requested" ? null : decision)} />
        </div>
      ) : answered ? (
        <p role="status" className="mt-4 t-body-compact text-fg" data-testid="v3-students-panel-handoff-answered">
          {/* Отказ в той же записи возвращает дело в ожидание без куратора (182); вид не называем —
              куратору со своей областью дело без куратора не видно. */}
          {answered === "accepted" ? "Дело принято." : "Назначение отклонено. Дело снова ждёт куратора."}
        </p>
      ) : null}

      <dl className="mt-4 divide-y divide-border border-t border-border">
        {stage ? <Fact term="Этап">{next ? <StageTrack kind="admissions" current={row.pipelineStage} /> : stage}</Fact> : null}
        <Fact term="Куратор">
          {/* Отказ возможен только по переданному делу, поэтому после него дело ждёт куратора — как в строке списка. */}
          {answered === "declined" ? <span className="font-medium text-danger">нужен куратор</span>
            : (next && row.currentCuratorDisplayName ? (
              <span className="inline-flex items-center gap-2"><Initials name={row.currentCuratorDisplayName} decorative />{row.currentCuratorDisplayName}</span>
            ) : row.currentCuratorDisplayName) ?? (row.attentionFlags.includes("needs_curator") ? <span className="font-medium text-danger">нужен куратор</span> : <span className="text-fg-3">не назначен</span>)}
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
                {due ? <> · <time dateTime={due.dateTime} className={`font-mono tabular-nums ${due.overdue && !next ? "text-danger" : ""}`}>{due.text}</time>{dueWord ? <> <DueWord view={dueWord} /></> : due.word ? <span className={due.overdue ? "text-danger" : "text-fg-2"}> {due.word}</span> : null}</> : null}
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
              const taskDueWord = next && taskDue ? dueWordOf({ dueOn: task.dueOn, dueAt: task.dueAt }, now) : null;
              const word = task.status === "blocked" ? taskStatus(task.status) : null;
              return (
                <li key={task.id} className="py-2">
                  <Link href={links.task(task.id)} className="block break-words t-body-compact text-fg underline-offset-4 hover:underline">{task.title}</Link>
                  <p className="t-meta text-fg-2">
                    {taskDue ? <><time dateTime={taskDue.dateTime} className={`font-mono tabular-nums ${taskDue.overdue && !next ? "text-danger" : ""}`}>{taskDue.text}</time>{taskDueWord ? <> <DueWord view={taskDueWord} /></> : taskDue.word ? <span className={taskDue.overdue ? "text-danger" : undefined}> {taskDue.word}</span> : null}</> : "без срока"}
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
        {documents && next ? (
          // Новый облик: полоса «N из M принято» — только из прочитанных чисел чек-листа;
          // пустой чек-лист — прежняя строка «Чек-лист не собран», без полосы.
          <div className="space-y-2">
            {row.documents && row.documents.total > 0
              ? <ProgressBar done={row.documents.approved} total={row.documents.total} word="принято" />
              : <p className="t-body-compact text-fg">{documents.summary}</p>}
            {documents.parts.length ? (
              <p className="flex flex-wrap gap-1">
                {documents.parts.map((part) => <StatusChip key={part.key} label={part.text} tone={part.tone === "warn" ? "warn" : part.tone === "danger" ? "danger" : "neutral"} />)}
              </p>
            ) : null}
          </div>
        ) : documents ? (
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
