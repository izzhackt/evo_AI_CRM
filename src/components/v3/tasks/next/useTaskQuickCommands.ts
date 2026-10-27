"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import type { QueueTask } from "@/lib/v3/task-queue";

import { STAFF_ERROR_COPY, staffEditForm, staffStatusForm, tomorrowDeadline } from "../task-commands";
import { useTaskTable } from "./TaskTableContext";

const RETRY = "Не удалось сохранить. Повторите.";

/**
 * Быстрые команды строки рабочей задачи — те же, что у круга и пункта «Перенести на завтра» прежней строки:
 * `mutate_staff_task` status/edit с версией строки, свой ключ запроса на каждое нажатие. Замок `busy` синхронный:
 * `pending` меняется только после рендера, и второй быстрый щелчок успел бы отправить команду ещё раз.
 * Отказ уходит в таблицу (`setError`) и называется под названием задачи.
 */
export function useTaskQuickCommands(task: QueueTask) {
  const table = useTaskTable();
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);

  async function guarded(command: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    table.setError(task.key, null);
    try {
      await command();
    } catch {
      table.setError(task.key, RETRY);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const idle = () => ({ status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null }) as const;

  return {
    pending,
    complete: () => guarded(async () => {
      const state = await mutateStaffTaskAction(idle(), staffStatusForm(task, "done"));
      if (state.status === "saved" && state.version) {
        table.onCompleted(task, { task, version: state.version, previousStatus: task.status, expired: false });
        table.announce(`Задача «${task.title}» завершена.`);
      } else table.setError(task.key, STAFF_ERROR_COPY[state.status] ?? RETRY);
    }),
    postponeToTomorrow: () => guarded(async () => {
      const state = await mutateStaffTaskAction(idle(), staffEditForm(task, { deadline: tomorrowDeadline(task, new Date()) }));
      if (state.status === "saved") {
        table.announce(`Задача «${task.title}» перенесена на завтра.`);
        router.refresh();
      } else table.setError(task.key, STAFF_ERROR_COPY[state.status] ?? RETRY);
    }),
  };
}
