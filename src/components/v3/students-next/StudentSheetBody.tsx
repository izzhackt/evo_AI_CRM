"use client";

import { useEffect, useState } from "react";

import { KeyFacts } from "@/components/kit";
import type { CaseClosure, CaseClosureReceipt } from "@/lib/platform-closure-contract";
import type { CaseNextActionReceipt, StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

import { DueWord } from "../blocks/DueWord";
import { Initials } from "../blocks/Initials";
import { StageTrack } from "../blocks/StageTrack";
import { ClosedLine, CloseRecordButton } from "../closure/Closure";
import { ProfileHandoffAcknowledgement } from "../profile/ProfileSalesTransition";
import { dueWordOf, queueDue } from "../queue/due-bucket";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import type { TaskComposerPageContext } from "../tasks/task-composer-context";
import { NextStepEditor } from "../students/NextStepEditor";
import { type NextStepAccess, type StudentsHandoff, type StudentsOpenTasks } from "../students/students-queue-view";
import { SheetSection, StudentSheetDocuments, StudentSheetTasks } from "./StudentSheetSections";

export type StudentSheetLinks = Readonly<{
  tasks: string;
  documents: string;
  createTask: string | null;
  task: (taskId: string) => string;
}>;

const NEED_CURATOR = <span className="font-medium text-danger">нужен куратор</span>;

/**
 * Содержимое панели дела в «Студентах»: этап, куратор, «Следующий шаг» с прежним редактором, открытые задачи, документы
 * и (редкое — последним) «Завершить дело». Приём дела — первым, если он ждёт ответа куратора. Команды, права и ключи запросов
 * те же, что у прежней боковой панели; сервер проверяет каждую запись.
 */
export function StudentSheetBody({ row, today, now, access, tasks, handoff, closure, requestId, links, onSaved, onClosureChanged, onCreateTask }: Readonly<{
  row: StudentCaseQueueRow;
  today: string;
  now: Date;
  access: NextStepAccess;
  tasks: StudentsOpenTasks | null;
  handoff: StudentsHandoff | null;
  closure: CaseClosure | null;
  requestId: string;
  links: StudentSheetLinks;
  onSaved: (receipt: CaseNextActionReceipt) => void;
  onClosureChanged: (receipt: CaseClosureReceipt) => void;
  onCreateTask: (context: TaskComposerPageContext) => boolean;
}>) {
  const [receipt, setReceipt] = useState<CaseClosureReceipt | null>(null);
  const [answered, setAnswered] = useState<"accepted" | "declined" | null>(null);
  const changed = (update: CaseClosureReceipt) => { setReceipt(update); onClosureChanged(update); };
  // Блок приёма ушёл после ответа: фокус с исчезнувшей кнопки переходит на название панели.
  useEffect(() => {
    if (!answered || handoff) return;
    const active = document.activeElement;
    if (active === null || active === document.body) document.querySelector<HTMLElement>("[data-slot=sheet-title]")?.focus();
  }, [answered, handoff]);

  const known = receipt && receipt.state === row.state ? receipt : null;
  const closedFacts = known && known.state === "closed"
    ? { outcome: known.outcome, note: known.note, closedAt: known.closedAt }
    : closure?.state === "closed" && row.state === "closed" ? { outcome: closure.outcome, note: closure.note, closedAt: closure.closedAt } : null;
  const canChange = closure?.canChange === true;
  const awaiting = !answered && row.attentionFlags.includes("awaiting_ack");
  const due = row.nextAction && row.nextActionDueOn ? queueDue({ dueOn: row.nextActionDueOn, dueAt: null }, now, row.state === "active") : null;
  const dueWord = due ? dueWordOf({ dueOn: row.nextActionDueOn, dueAt: null }, now, row.state === "active") : null;
  const curator = answered === "declined" ? NEED_CURATOR
    : row.currentCuratorDisplayName ? <span className="inline-flex items-center gap-2"><Initials name={row.currentCuratorDisplayName} decorative />{row.currentCuratorDisplayName}</span>
    : row.attentionFlags.includes("needs_curator") ? NEED_CURATOR : <span className="text-fg-3">не назначен</span>;
  const state = row.state === "closed" && closedFacts ? (
    <ClosedLine key={row.admissionsVersion} kind="case" subjectId={row.studentCaseId} expectedVersion={row.admissionsVersion}
      reasonKey={closedFacts.outcome} note={closedFacts.note} closedAt={closedFacts.closedAt} canReopen={canChange} onReopened={changed} />
  ) : row.state !== "active" ? (row.state === "closed" ? "Дело закрыто" : "Ожидает начала") : null;

  return (
    <div className="space-y-4" data-testid="v3-student-sheet">
      {handoff ? (
        <div data-testid="v3-students-panel-handoff">
          <ProfileHandoffAcknowledgement snapshot={handoff} onSaved={(decision) => setAnswered(decision === "clarification_requested" ? null : decision)} />
        </div>
      ) : answered ? (
        <p role="status" className="t-body-compact text-fg" data-testid="v3-students-panel-handoff-answered">
          {answered === "accepted" ? "Дело принято." : "Назначение отклонено. Дело снова ждёт куратора."}
        </p>
      ) : null}
      <KeyFacts columns={1} facts={[
        { label: "Этап", value: admissionsPipelineStage(row.pipelineStage) ? <StageTrack kind="admissions" current={row.pipelineStage} closed={row.state === "closed"} /> : null },
        { label: "Куратор", value: <>{curator}{awaiting ? <span className="block font-medium text-warn">ждёт принятия</span> : null}</> },
        { label: "Состояние", value: state },
      ]} />
      {row.state === "active" && known ? <p role="status" className="t-body-compact text-ok">Дело снова в работе.</p> : null}
      <SheetSection title="Следующий шаг">
        {access.kind === "edit" ? <NextStepEditor key={row.studentCaseId} row={row} today={today} requestId={requestId} onSaved={onSaved} /> : <>
          {row.nextAction ? (
            <p className="t-body-compact break-words text-fg">
              {row.nextAction}
              {due ? <> · <time dateTime={due.dateTime} className="font-mono tabular-nums">{due.text}</time>{dueWord ? <> <DueWord view={dueWord} /></> : null}</> : null}
            </p>
          ) : <p className="t-body-compact text-fg-3">Шаг не задан</p>}
          {access.reason ? <p className="t-body-compact text-fg-2">{access.reason}</p> : null}
        </>}
      </SheetSection>
      <StudentSheetTasks row={row} tasks={tasks} now={now} tasksHref={links.tasks} createTaskHref={links.createTask} taskHref={links.task} onCreateTask={onCreateTask} />
      <StudentSheetDocuments row={row} href={links.documents} />
      {row.state === "active" && canChange && (known !== null || closure?.state === "active") ? (
        <div className="border-t border-border pt-4">
          <CloseRecordButton kind="case" subjectId={row.studentCaseId} subjectName={row.studentDisplayName} expectedVersion={row.admissionsVersion}
            onClosed={changed} className={QUEUE_SECONDARY} openTasks={tasks?.kind === "ready" ? tasks.tasks.length : null} />
        </div>
      ) : null}
    </div>
  );
}
