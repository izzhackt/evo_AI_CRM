"use client";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { DueWord } from "../../blocks/DueWord";
import { Initials } from "../../blocks/Initials";
import { dueWordOf, queueDue } from "../../queue/due-bucket";
import { DialButton } from "../../telephony/DialButton";
import { taskRowAbilities } from "../TaskQueueRow";
import { useTaskTable } from "./TaskTableContext";
import type { TaskRow } from "./task-table-model";
import { useTaskQuickCommands } from "./useTaskQuickCommands";

/** Срок: моноширинная дата и слово рядом («прошёл 3 дн» красным, «сегодня»); у завершённых — подпись «срок». Без срока — так и сказано. */
export function TaskDueCell({ row }: Readonly<{ row: TaskRow }>) {
  const table = useTaskTable();
  const now = new Date(table.nowIso);
  const due = queueDue(row.task, now, table.open);
  if (!due) return <span className="t-body-compact text-fg-3">Без срока</span>;
  const word = table.recent[row.key] ? null : dueWordOf(row.task, now, table.open);
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 t-body-compact md:justify-start">
      <time dateTime={due.dateTime} className="whitespace-nowrap font-mono tabular-nums text-fg">{due.text}</time>
      {word ? <DueWord view={word} /> : due.caption ? <span className="t-meta text-fg-3">{due.caption}</span> : null}
    </div>
  );
}

export function TaskAssigneeCell({ row }: Readonly<{ row: TaskRow }>) {
  const name = row.task.assigneeDisplayName;
  return (
    <span className="flex min-w-0 items-center gap-2 t-body-compact text-fg-2" title={name}>
      <Initials name={name} decorative />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * «Позвонить» (только пока база открыла набор этому сотруднику и у задачи есть клиент) и «⋯»: «Перенести на
 * завтра» рабочей задачи — сразу, как раньше; «Передать…» и перенос задачи по студенту (нужна причина) — в панели
 * задачи с раскрытым разделом.
 */
export function TaskActionsCell({ row }: Readonly<{ row: TaskRow }>) {
  const table = useTaskTable();
  const { task, lead } = row;
  const commands = useTaskQuickCommands(task);
  const done = Boolean(table.recent[task.key]);
  const can = taskRowAbilities(task, table.permissions, table.open, new Date(table.nowIso));
  const dial = lead && table.dial?.status === "ready" && table.open && !done ? { leadId: lead.leadId, mapped: table.dial.mapped, name: lead.name } : null;
  const staff = task.kind === "staff";
  return (
    <div className="relative z-0 flex justify-end">
      {dial ? <DialButton leadId={dial.leadId} mapped={dial.mapped} variant="row" subject={dial.name} sharedHint /> : null}
      {!done && (can.postpone || can.transfer) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Действия: ${task.title}`}><Icon name="more-horizontal" size={20} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {staff && can.postpone ? (
              <DropdownMenuItem disabled={commands.pending} onSelect={() => void commands.postponeToTomorrow()}>Перенести на завтра</DropdownMenuItem>
            ) : null}
            {(staff ? can.transfer : can.postpone || can.transfer) ? (
              <DropdownMenuItem asChild>
                <Link href={table.panelHref(task, true)} scroll={false}>{staff ? "Передать…" : "Перенести или передать…"}</Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
