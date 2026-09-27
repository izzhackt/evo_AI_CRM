"use client";

import { useEffect, useRef, useState } from "react";

import type { QueueTask } from "@/lib/v3/task-queue";

import type { V3Look } from "../blocks/look";
import { TaskQueueRow, type TaskRowPermissions } from "../tasks/TaskQueueRow";
import { CASE_TASKS_SHOWN } from "./case-work-view";

const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/** Задача дела открывается в «Задачах» — той же панелью, что из очереди. */
function taskHref(task: QueueTask, move = false): string {
  const query = new URLSearchParams({ task: task.id, kind: "case", case: task.studentCaseId ?? "" });
  if (move) query.set("move", "1");
  return `/v3/tasks?${query.toString()}`;
}

/**
 * Открытые задачи дела строками «Задач» (`TaskQueueRow`): выполнение в строке
 * с результатом, «Перенести на завтра» и «Передать…» — те же команды и те же
 * права. Первые шесть видны сразу, остальные — по «Показать ещё»: кнопка
 * уходит, фокус переходит на заголовок первой открытой задачи, а не падает
 * на страницу (review Э4, 27.09).
 */
export function CaseTaskList({
  tasks,
  permissions,
  nowIso,
  look,
}: Readonly<{
  tasks: readonly QueueTask[];
  permissions: TaskRowPermissions;
  nowIso: string;
  /** Новый облик (Э1.3): срок словом и инициалы в строках. */
  look?: V3Look;
}>) {
  const [all, setAll] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const revealFrom = useRef<number | null>(null);
  useEffect(() => {
    if (!all || revealFrom.current === null) return;
    const row = listRef.current?.children.item(revealFrom.current);
    revealFrom.current = null;
    row?.querySelector<HTMLElement>("[data-queue-open]")?.focus();
  }, [all]);
  const shown = all ? tasks : tasks.slice(0, CASE_TASKS_SHOWN);
  const hidden = tasks.length - shown.length;
  return (
    <div className="@container min-w-0">
      <ul ref={listRef} className="border-t border-border" data-testid="v3-case-tasks">
        {shown.map((task) => (
          <TaskQueueRow
            key={task.key}
            task={task}
            href={taskHref(task)}
            moveHref={taskHref(task, true)}
            selected={false}
            open
            showAssignee
            hideStudent
            nowIso={nowIso}
            permissions={permissions}
            look={look}
            recent={null}
            // Задача по студенту завершается с результатом через окно строки и
            // перечитывает страницу; «Отменить» есть только у рабочих задач.
            onCompleted={() => {}}
            onUndo={async () => null}
            announce={setAnnouncement}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" onClick={() => { revealFrom.current = shown.length; setAll(true); }} className={LINK}>
          Показать ещё {hidden}
        </button>
      ) : null}
      <p role="status" className="sr-only">{announcement}</p>
    </div>
  );
}
