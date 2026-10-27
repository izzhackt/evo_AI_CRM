"use client";

import Link from "next/link";

import { StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";
import { caseDocumentsAwaitCurator } from "@/lib/v3/case-access-contract";
import { caseDocumentsWords, taskStatus } from "@/lib/v3/wording";

import { DueWord } from "../blocks/DueWord";
import { ProgressBar } from "../blocks/ProgressBar";
import { dueWordOf, queueDue } from "../queue/due-bucket";
import { openTaskComposer, TaskComposerContextMark } from "../tasks/task-composer-context";
import { studentsDocumentsLine, type StudentsOpenTasks } from "../students/students-queue-view";

/** Сколько открытых задач показывает панель; остальные — в деле. */
export const SHEET_TASKS = 5;

export function SheetSection({ title, action, children }: Readonly<{ title: string; action?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <section aria-label={title} className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="t-item text-fg">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Открытые задачи дела (до пяти), «+ Задача» тем же диалогом оболочки и честное «недоступно». */
export function StudentSheetTasks({ row, tasks, now, tasksHref, createTaskHref, taskHref }: Readonly<{
  row: StudentCaseQueueRow;
  tasks: StudentsOpenTasks | null;
  now: Date;
  tasksHref: string;
  createTaskHref: string | null;
  taskHref: (taskId: string) => string;
}>) {
  const open = tasks?.kind === "ready" ? tasks.tasks : [];
  const subject = { case: { id: row.studentCaseId, name: row.studentDisplayName } };
  return (
    <SheetSection title="Задачи" action={createTaskHref ? <>
      <TaskComposerContextMark value={subject} />
      <Button variant="ghost" asChild>
        <Link href={createTaskHref} aria-haspopup="dialog" onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (openTaskComposer({ ...subject, caseFixed: true })) event.preventDefault();
        }}>+ Задача</Link>
      </Button>
    </> : null}>
      {tasks === null || tasks.kind === "unavailable" ? (
        <p className="t-body-compact text-fg-2">Задачи сейчас недоступны. <Link href={tasksHref} className="underline underline-offset-4">Задачи в деле</Link></p>
      ) : open.length === 0 ? <p className="t-body-compact text-fg-3">Открытых задач нет.</p> : (
        <ul className="divide-y divide-border">
          {open.slice(0, SHEET_TASKS).map((task) => {
            const due = queueDue({ dueOn: task.dueOn, dueAt: task.dueAt }, now);
            const word = due ? dueWordOf({ dueOn: task.dueOn, dueAt: task.dueAt }, now) : null;
            return (
              <li key={task.id} className="py-2">
                <Link href={taskHref(task.id)} className="block break-words t-body-compact text-fg underline-offset-4 hover:underline">{task.title}</Link>
                <p className="t-meta text-fg-2">
                  {due ? <><time dateTime={due.dateTime} className="font-mono tabular-nums">{due.text}</time>{word ? <> <DueWord view={word} /></> : null}</> : "без срока"}
                  {task.status === "blocked" ? <span className="text-warn"> · {taskStatus(task.status)}</span> : null}
                  <span> · исп. {task.assigneeDisplayName}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {open.length > SHEET_TASKS ? <Button variant="ghost" asChild><Link href={tasksHref}>Все задачи дела · {open.length}</Link></Button> : null}
    </SheetSection>
  );
}

/** Полоса «N из M принято» из прочитанных чисел чек-листа и слова состояния; у дела без куратора рабочего места нет. */
export function StudentSheetDocuments({ row, href }: Readonly<{ row: StudentCaseQueueRow; href: string }>) {
  const awaiting = caseDocumentsAwaitCurator(row.state);
  const line = studentsDocumentsLine(row.documents);
  return (
    <SheetSection title="Документы" action={awaiting ? null : <Button variant="ghost" asChild><Link href={href}>Документы дела</Link></Button>}>
      {awaiting ? <p className="t-body-compact text-fg-2" data-testid="v3-students-panel-documents-await">{caseDocumentsWords.awaitCurator}</p> : line ? (
        <div className="space-y-2">
          <ProgressBar done={row.documents?.approved} total={row.documents?.total} word="принято" fallback={<p className="t-body-compact text-fg">{line.summary}</p>} />
          {line.parts.length ? (
            <p className="flex flex-wrap gap-1">
              {line.parts.map((part) => <StatusBadge key={part.key} label={part.text} tone={part.tone === "muted" ? "neutral" : part.tone} />)}
            </p>
          ) : null}
        </div>
      ) : <p className="t-body-compact text-fg-3">Нет доступа к документам этого дела.</p>}
    </SheetSection>
  );
}
