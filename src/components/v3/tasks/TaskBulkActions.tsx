"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { changePlatformAdmissionsTaskAction } from "@/lib/platform-admissions-task-actions";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import type { QueueTask } from "@/lib/v3/task-queue";

import { BulkActionDialog, BulkBar, BulkDueField, bulkDueDay, useBulkRequestIds, type BulkDueChoice, type BulkSelection } from "../queue/Bulk";
import { QUEUE_FIELD } from "../queue/queue-buttons";
import { CASE_ERROR_COPY, STAFF_ERROR_COPY, caseChangeForm, movedDeadline, staffEditForm } from "./task-commands";

export const TASK_NOUN = { one: "задача", few: "задачи", many: "задач" } as const;

type TaskItem = Readonly<{ key: string; label: string; task: QueueTask }>;

/**
 * Одна строка переноса срока — существующая команда этой задачи (Э7):
 * рабочая — `mutate_staff_task` edit, по студенту — `change_case_task` с
 * причиной. Своя ожидаемая версия, свой ключ запроса; ответ — причина
 * отказа словами или null.
 */
export async function rescheduleTask(
  task: QueueTask,
  day: string | null,
  reason: string,
  requestId: string,
  now: Date,
): Promise<Readonly<{ error: string | null; unconfirmed: boolean }>> {
  const deadline = movedDeadline(task, day, now);
  if (task.kind === "staff") {
    const form = staffEditForm(task, { deadline });
    form.set("request_id", requestId);
    const state = await mutateStaffTaskAction({ status: "idle", requestId, taskId: null, version: null }, form);
    return state.status === "saved"
      ? { error: null, unconfirmed: false }
      : { error: STAFF_ERROR_COPY[state.status] ?? "Не удалось сохранить.", unconfirmed: state.status === "unavailable" };
  }
  if (!task.studentCaseId || task.studentVisible === null) return { error: CASE_ERROR_COPY.invalid, unconfirmed: false };
  const form = caseChangeForm({ ...task, studentCaseId: task.studentCaseId, studentVisible: task.studentVisible }, { deadline, reason });
  form.set("request_id", requestId);
  const state = await changePlatformAdmissionsTaskAction(
    { status: "idle", requestId, caseTaskId: null, version: null, changedAt: null }, form,
  );
  return state.status === "saved"
    ? { error: null, unconfirmed: false }
    : { error: CASE_ERROR_COPY[state.status] ?? "Не удалось сохранить.", unconfirmed: state.status === "unavailable" };
}

/**
 * «Перенести срок» выбранных задач (Э7). Выбирают только задачи, которые
 * сотрудник может править (`taskRowAbilities`); сервер проверяет каждую сам.
 */
export function TaskBulkActions({
  selection,
  tasks,
  allKeys,
  nowIso,
}: Readonly<{
  selection: BulkSelection;
  /** Выбираемые задачи страницы по ключу. */
  tasks: ReadonlyMap<string, QueueTask>;
  allKeys: readonly string[];
  nowIso: string;
}>) {
  const router = useRouter();
  const requestIds = useBulkRequestIds();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [choice, setChoice] = useState<BulkDueChoice>("tomorrow");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  // «Сегодня», «Завтра», «Пт» — от момента чтения сервера, как сроки строк.
  const today = dayInOrganizationTimezone(new Date(nowIso));
  const items: TaskItem[] = selection.keys.flatMap((key) => {
    const task = tasks.get(key);
    return task ? [{ key, label: task.title, task }] : [];
  });
  const needsReason = items.some((item) => item.task.kind === "case");

  return (
    <BulkBar selection={selection} allKeys={allKeys} noun={TASK_NOUN} keep={dialogOpen}>
      <BulkActionDialog<TaskItem>
        title="Перенести срок"
        triggerLabel="Перенести срок"
        testId="task-bulk-reschedule"
        items={items}
        skipped={[]}
        noun={TASK_NOUN}
        selection={selection}
        onOpenChange={setDialogOpen}
        validate={() => {
          const day = bulkDueDay(choice, date, today);
          if (day === "") return "Выберите дату.";
          if (needsReason && !reason.trim()) return "Напишите причину: без неё срок задачи по студенту не меняется.";
          return null;
        }}
        command={async (item) => {
          const result = await rescheduleTask(item.task, bulkDueDay(choice, date, today), reason, requestIds.idFor(item.key), new Date());
          requestIds.settle(item.key, result.unconfirmed);
          return result.error;
        }}
        onFinished={() => router.refresh()}
      >
        <BulkDueField today={today} choice={choice} date={date} onChoice={setChoice} onDate={setDate} />
        <p className="t-meta text-fg-2">У задач со временем время срока сохраняется.</p>
        {needsReason ? (
          <label className="block t-label text-fg">
            Причина переноса · для задач по студентам
            <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className={QUEUE_FIELD} />
          </label>
        ) : null}
      </BulkActionDialog>
    </BulkBar>
  );
}
