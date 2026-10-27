"use client";

import Link from "next/link";

import { DetailSheet, KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sheetEscape } from "@/components/v3/panel/sheet-escape";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";

import { formatQueueDay } from "../../queue/due-bucket";
import { statePill, taskStateKey } from "../grids";
import { CalendarTaskControls } from "../TaskControls";
import {
  calendarCapabilitiesForTask,
  clockLabel,
  type CalendarAssigneeOption,
  type CalendarTask,
  type CalendarTaskCapabilities,
  type CalendarTaskRequestIds,
  type Day,
} from "../types";

/** Срок словами: «24.09 10:00», «24.09 · весь день» или «Без срока» (год — только не текущий, как в сетке). */
export function dueFactValue(task: CalendarTask, today: Day): React.ReactNode {
  if (task.day === null) return "Без срока";
  return (
    <span className="font-mono">
      {formatQueueDay(task.day, today)}
      {task.minutes === null ? " · весь день" : ` ${clockLabel(task.minutes)}`}
    </span>
  );
}

/**
 * Панель задачи «Календаря»: те же данные, ссылки и формы дела, что в прежней панели (`CalendarTaskControls` — прежняя
 * форма с теми же командами и request_id), в `DetailSheet` набора. Состояние словом, срок, исполнитель, студент — `KeyFacts`;
 * описание и причина отмены на виду. Форм у рабочей задачи нет: она правится в «Задачах» (ссылка в подвале).
 * Пока сервер читает точные права на задачу (`confirmed` ложно), под названием скелет.
 */
export function CalendarTaskSheet({
  task, open, confirmed, unavailableHref, today, day, assignees, actor, capabilities, requestIds, onClose, restoreFocus,
}: Readonly<{
  task: CalendarTask | null;
  open: boolean;
  confirmed: boolean;
  /** Задача из адреса недоступна в личном календаре: куда вернуться. */
  unavailableHref: string | null;
  today: Day;
  day: Day;
  assignees: readonly CalendarAssigneeOption[];
  actor: ActivePlatformActor;
  capabilities: CalendarTaskCapabilities | null;
  requestIds: Readonly<Record<string, CalendarTaskRequestIds>>;
  onClose: () => void;
  restoreFocus: () => void;
}>) {
  const key = task ? taskStateKey(task) : null;
  const pill = key ? statePill(key) : null;
  const caps = task ? calendarCapabilitiesForTask(task, capabilities) : null;
  const controls = task?.kind === "case" && confirmed && caps && requestIds[task.key] && task.caseState === "active"
    && task.state !== "done" && task.state !== "cancelled" && !isStaffPreview(actor) && staffHasPermission(actor, "task.manage");
  const footer = task?.kind === "case" && caps?.canReadCase
    ? <Button variant="outline" asChild><Link href={`/v3/profile?case=${encodeURIComponent(task.studentCaseId)}`}>Открыть дело</Link></Button>
    : task?.kind === "staff"
      ? <Button variant="outline" asChild><Link href={`/v3/tasks?type=staff&view=mine&status=all&task=${encodeURIComponent(task.id)}`}>Открыть задачу</Link></Button>
      : undefined;
  return (
    <DetailSheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}
      onEscapeKeyDown={sheetEscape}
      title={task?.title ?? "Задача недоступна"}
      description={task?.person ?? undefined}
      footer={confirmed ? footer : undefined}
    >
      {unavailableHref ? (
        <div className="grid justify-items-start gap-3" data-testid="v3-calendar-unavailable">
          <p role="status" className="t-body-compact text-fg-2">Эта задача недоступна в вашем личном календаре.</p>
          <Button variant="outline" asChild><Link href={unavailableHref}>Вернуться в календарь</Link></Button>
          <Button variant="ghost" asChild><Link href="/v3/tasks">Все задачи</Link></Button>
        </div>
      ) : task ? (
        <div className="grid min-w-0 gap-4" data-testid="v3-calendar-task-panel">
          <div className="flex flex-wrap items-center gap-2">{pill ? <StatusBadge label={pill.word} tone={pill.tone} /> : null}</div>
          <KeyFacts columns={2} facts={[{ label: "Срок", value: dueFactValue(task, today) }, { label: "Исполнитель", value: task.assigneeDisplayName }]} />
          {task.details ? <p className="t-body-compact whitespace-pre-wrap text-fg">{task.details}</p> : null}
          {task.cancelReason ? <p className="t-body-compact text-fg-2">Причина: {task.cancelReason}</p> : null}
          {!confirmed ? (
            <div className="space-y-2" aria-busy="true">
              <p role="status" className="sr-only">Открываем задачу…</p>
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-11 w-40" />
            </div>
          ) : null}
          {controls && task.kind === "case" && caps ? (
            <CalendarTaskControls key={task.id} task={task} day={day} assignees={assignees} actor={actor} capabilities={caps} requestIds={requestIds[task.key]} />
          ) : null}
        </div>
      ) : null}
    </DetailSheet>
  );
}
