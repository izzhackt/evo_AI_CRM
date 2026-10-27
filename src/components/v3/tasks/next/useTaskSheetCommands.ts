"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { changePlatformAdmissionsTaskAction } from "@/lib/platform-admissions-task-actions";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";

import { CASE_ERROR_COPY, STAFF_ERROR_COPY, caseChangeForm, staffEditForm, staffStatusForm, type DeadlineFieldValues } from "../task-commands";
import type { TaskSheetData } from "./task-sheet-data";

function deadlineFields(form: FormData): DeadlineFieldValues {
  const kind = String(form.get("deadline_kind") ?? "");
  return {
    deadlineKind: kind === "all_day" || kind === "timed" ? kind : "none",
    dueOn: String(form.get("due_on") ?? ""),
    dueAt: String(form.get("due_at") ?? ""),
  };
}

/**
 * Команды панели задачи — те же, что у `TaskDetailPanel` прежнего вида: завершение (рабочая — с необязательным
 * результатом, по студенту — с обязательным) и «Перенести или передать» (исполнитель и срок; у задачи по студенту
 * ещё причина). Каждая — существующее серверное действие со своим ключом запроса и версией задачи; права проверяет
 * сервер, здесь только состояние формы и слова отказа.
 */
export function useTaskSheetCommands(data: TaskSheetData) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [completeReason, setCompleteReason] = useState("");
  const [editReason, setEditReason] = useState("");
  const [assignee, setAssignee] = useState(data.task.assigneeMembershipId);
  const caseTask = data.kind === "case" ? {
    id: data.task.id, version: data.task.version, studentCaseId: data.caseId, priority: data.task.priority,
    status: data.task.state, assigneeMembershipId: data.task.assigneeMembershipId, studentVisible: data.task.studentVisible,
    dueOn: data.task.dueOn, dueAt: data.task.dueAt,
  } : null;
  const caseIdle = () => ({ status: "idle", requestId: crypto.randomUUID(), caseTaskId: null, version: null, changedAt: null }) as const;
  const staffIdle = () => ({ status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null }) as const;

  async function run(action: () => Promise<{ status: string }>, copy: Readonly<Record<string, string>>, saved: string, reset?: () => void) {
    setPending(true); setError(null); setNotice(null);
    try {
      const result = await action();
      if (result.status === "saved") { setNotice(saved); reset?.(); router.refresh(); }
      else setError(copy[result.status] ?? "Не удалось сохранить.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { setPending(false); }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (data.kind === "staff") {
      await run(() => mutateStaffTaskAction(staffIdle(), staffStatusForm(data.task, "done", completionNote)), STAFF_ERROR_COPY, "Задача завершена.");
      return;
    }
    if (!completeReason.trim()) { setError("Напишите результат: без него задача по студенту не завершается."); return; }
    await run(() => changePlatformAdmissionsTaskAction(caseIdle(), caseChangeForm(caseTask!, { status: "done", reason: completeReason })),
      CASE_ERROR_COPY, "Задача завершена.", () => setCompleteReason(""));
  }

  async function saveAssigneeDue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const deadline = deadlineFields(new FormData(event.currentTarget));
    if (data.kind === "staff") {
      await run(() => mutateStaffTaskAction(staffIdle(), staffEditForm(data.task, { assigneeMembershipId: assignee, deadline })), STAFF_ERROR_COPY, "Сохранено.");
      return;
    }
    if (!editReason.trim()) { setError("Укажите причину изменения."); return; }
    await run(() => changePlatformAdmissionsTaskAction(caseIdle(), caseChangeForm(caseTask!, { assigneeMembershipId: assignee, deadline, reason: editReason })),
      CASE_ERROR_COPY, "Сохранено.", () => setEditReason(""));
  }

  return {
    error, notice, pending, complete, saveAssigneeDue,
    completionNote, setCompletionNote, completeReason, setCompleteReason, editReason, setEditReason, assignee, setAssignee,
  };
}
