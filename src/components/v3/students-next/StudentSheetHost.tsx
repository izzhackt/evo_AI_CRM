"use client";

import Link from "next/link";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { CaseClosure, CaseClosureReceipt } from "@/lib/platform-closure-contract";
import type { CaseNextActionReceipt, StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { studentsRowMeta } from "../students/StudentsQueueTable";
import { nextStepAccess, studentsCaseHref, type NextStepAccessInput, type StudentsHandoff, type StudentsOpenTasks } from "../students/students-queue-view";
import { StudentSheetBody } from "./StudentSheetBody";

/**
 * Панель дела. Открыта ли она, решает адрес (`?open=`): страница читает задачи, приём и закрытие открытого дела и отдаёт
 * их вместе со списком; закрытие ведёт на адрес списка и срабатывает сразу, не дожидаясь сервера
 * (`dismissed`, см. `useDismissedSheet`). Дела нет на этой странице списка — панель так и говорит и ведёт к делу.
 */
export function StudentSheetHost({ openKey, row, dismissed, onDismiss, returnTo, today, now, editor, recordScopes, tasks, handoff, closure, createTask, requestId, onSaved, onClosureChanged }: Readonly<{
  openKey: string | null;
  row: StudentCaseQueueRow | null;
  dismissed: boolean;
  onDismiss: () => void;
  returnTo: string;
  today: string;
  now: Date;
  editor: NextStepAccessInput;
  recordScopes: readonly string[];
  tasks: StudentsOpenTasks | null;
  handoff: StudentsHandoff | null;
  closure: CaseClosure | null;
  createTask: boolean;
  requestId: string;
  onSaved: (receipt: CaseNextActionReceipt) => void;
  onClosureChanged: (receipt: CaseClosureReceipt) => void;
}>) {
  if (openKey === null) return null;
  const caseHref = studentsCaseHref(openKey, { returnTo });
  const footer = <Button variant="outline" asChild><Link href={caseHref}>Открыть дело</Link></Button>;
  const open = !dismissed;
  const onOpenChange = (next: boolean) => { if (!next) onDismiss(); };
  if (!row) {
    return <DetailSheet open={open} onOpenChange={onOpenChange} title="Дела нет в этом списке" description="Оно в другом виде, на другой странице или недоступно вам." footer={footer}>
      <p className="t-body-compact text-fg-2">Откройте дело целиком или вернитесь к списку.</p>
    </DetailSheet>;
  }
  const caseUrl = (tab?: "documents") => studentsCaseHref(row.studentCaseId, { returnTo, ...(tab ? { tab } : {}) });
  return (
    <DetailSheet open={open} onOpenChange={onOpenChange} title={row.studentDisplayName} description={studentsRowMeta(row)} footer={footer}>
      <StudentSheetBody
        key={row.studentCaseId}
        row={row}
        today={today}
        now={now}
        access={nextStepAccess(editor, row, recordScopes)}
        tasks={tasks}
        handoff={handoff?.studentCaseId === row.studentCaseId ? handoff : null}
        closure={closure?.studentCaseId === row.studentCaseId ? closure : null}
        requestId={requestId}
        links={{
          tasks: `${caseUrl()}#case-tasks`,
          documents: caseUrl("documents"),
          createTask: createTask ? `/v3/tasks?create=case&case=${encodeURIComponent(row.studentCaseId)}` : null,
          task: (taskId) => `/v3/tasks?task=${encodeURIComponent(taskId)}&kind=case&case=${encodeURIComponent(row.studentCaseId)}`,
        }}
        onSaved={onSaved}
        onClosureChanged={onClosureChanged}
      />
    </DetailSheet>
  );
}
