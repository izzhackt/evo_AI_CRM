"use client";

import { useId } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";

import { QUEUE_CONFIRM } from "../../queue/queue-buttons";
import { ComposerDeadlineField } from "../ComposerDeadlineField";
import type { TaskSheetData } from "./task-sheet-data";
import type { useTaskSheetCommands } from "./useTaskSheetCommands";

type Commands = ReturnType<typeof useTaskSheetCommands>;

/** Завершение: у рабочей задачи результат необязателен, у задачи по студенту без него она не завершается. Подтверждение в панели — тёмная нейтральная кнопка (как в окне массовых действий): красная на странице одна, «Новая задача». */
export function TaskSheetComplete({ data, commands }: Readonly<{ data: TaskSheetData; commands: Commands }>) {
  const id = useId();
  const staff = data.kind === "staff";
  return (
    <form onSubmit={commands.complete} className="grid gap-3 border-t border-border pt-4">
      <div className="grid gap-1.5">
        <Label htmlFor={id}>Результат</Label>
        {staff
          ? <Textarea id={id} value={commands.completionNote} onChange={(event) => commands.setCompletionNote(event.target.value)} maxLength={4000} rows={2} disabled={commands.pending} placeholder="Что сделано и какой следующий шаг" />
          : <Input id={id} value={commands.completeReason} onChange={(event) => commands.setCompleteReason(event.target.value)} required maxLength={1000} disabled={commands.pending} placeholder="Что сделано" />}
      </div>
      <button type="submit" disabled={commands.pending} className={`${QUEUE_CONFIRM} justify-self-start`}>{commands.pending ? "Сохраняем…" : "Завершить"}</button>
    </form>
  );
}

/**
 * «Перенести или передать»: исполнитель и срок тем же редактором срока, что в диалоге «Новая задача». Раздел свёрнут,
 * пока его не открыли (пункт «Передать…» строки открывает его сразу). У задачи по студенту смена исполнителя — по
 * праву «назначать»; форма есть всегда, поле исполнителя без права — только текст.
 */
export function TaskSheetMove({ data, commands, open }: Readonly<{ data: TaskSheetData; commands: Commands; open: boolean }>) {
  const assigneeId = useId();
  const reasonId = useId();
  const options = data.kind === "staff" ? data.participants : data.assignees;
  const currentName = data.task.assigneeDisplayName;
  const projection = projectPlatformTaskDeadline(data.task.dueOn, data.task.dueAt, new Date(data.nowIso));
  const fixed = data.kind === "case" && !data.capabilities.canAssign;
  return (
    <details open={open} className="group border-t border-border pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 t-item text-fg [&::-webkit-details-marker]:hidden">
        Перенести или передать
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-fg-3 group-open:rotate-180" />
      </summary>
      <form onSubmit={commands.saveAssigneeDue} className="grid gap-3 pt-2">
        <div className="grid gap-1.5">
          <Label htmlFor={assigneeId}>Исполнитель</Label>
          {fixed ? <p className="t-body-compact text-fg">{currentName}</p> : (
            <Select value={commands.assignee} onValueChange={commands.setAssignee} disabled={commands.pending}>
              <SelectTrigger id={assigneeId}><SelectValue /></SelectTrigger>
              <SelectContent>
                {!options.some((person) => person.membershipId === commands.assignee) ? <SelectItem value={commands.assignee} disabled>{currentName}</SelectItem> : null}
                {options.map((person) => <SelectItem key={person.membershipId} value={person.membershipId}>{person.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <ComposerDeadlineField day={data.day} current={{ day: projection.day, minutes: projection.minutes, dueAt: data.task.dueAt }} disabled={commands.pending} />
        {data.kind === "case" ? (
          <div className="grid gap-1.5">
            <Label htmlFor={reasonId}>Причина изменения</Label>
            <Input id={reasonId} value={commands.editReason} onChange={(event) => commands.setEditReason(event.target.value)} required maxLength={1000} disabled={commands.pending} />
          </div>
        ) : null}
        <Button type="submit" variant="outline" disabled={commands.pending} className="justify-self-start">{commands.pending ? "Сохраняем…" : "Сохранить"}</Button>
      </form>
    </details>
  );
}
