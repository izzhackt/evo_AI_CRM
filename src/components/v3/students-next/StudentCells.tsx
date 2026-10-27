"use client";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { StatusBadge, type StatusTone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { stagePhase } from "@/lib/v3/stages";

import { DueWord } from "../blocks/DueWord";
import { StageChip } from "../blocks/StatusChip";
import { RowSelect } from "../queue/Bulk";
import { dueWordOf, queueDue } from "../queue/due-bucket";
import { shortPersonName } from "../queue/person-name";
import { studentsRowSignals, studentsUpdatedDay, type StudentsSignal } from "../students/students-queue-view";
import type { NextStudentRow } from "./students-next-model";
import { useStudentsTable } from "./StudentsTableContext";

/** Студент: отметка выбора (пока выбор открыт), имя-ссылка (открывает панель, область — вся ячейка) и «страна · уровень». */
export function StudentCell({ item }: Readonly<{ item: NextStudentRow }>) {
  const table = useStudentsTable();
  const { row } = item;
  const { selection } = table;
  return (
    <div data-queue-row={row.studentCaseId} data-testid="v3-student-case-row" data-student-case-id={row.studentCaseId} className="relative z-0 flex min-w-0 items-start">
      {selection && table.selectable.has(row.studentCaseId) ? (
        <span className={selection.revealed ? "contents" : "hidden"}>
          <RowSelect label={item.name} checked={selection.has(row.studentCaseId)} onToggle={() => selection.toggle(row.studentCaseId)} />
        </span>
      ) : selection?.revealed ? <span aria-hidden="true" className="size-11 shrink-0" /> : null}
      <div className="min-w-0 flex-1 py-0.5">
        <Link href={table.openHref(row)} scroll={false} data-queue-open="" title={item.name} aria-current={table.openKey === row.studentCaseId ? "true" : undefined}
          className="line-clamp-2 break-words py-0.5 t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline">
          {item.name}
        </Link>
        <p className="truncate t-meta text-fg-2" title={item.meta}>{item.meta}</p>
      </div>
    </div>
  );
}

/** «Следующий шаг» и срок: дата и слово («прошёл 3 дн», «сегодня»); при сортировке по обновлению — день изменения дела. */
export function StepCell({ item }: Readonly<{ item: NextStudentRow }>) {
  const { now, today, sort } = useStudentsTable();
  const { row } = item;
  const active = row.state === "active";
  const due = row.nextAction && row.nextActionDueOn ? queueDue({ dueOn: row.nextActionDueOn, dueAt: null }, now, active) : null;
  const updated = sort === "updated" ? studentsUpdatedDay(row.updatedAt, today) : null;
  const word = due && !updated ? dueWordOf({ dueOn: row.nextActionDueOn, dueAt: null }, now, active) : null;
  return (
    <div className="min-w-0 text-start">
      {row.nextAction ? <span className="line-clamp-2 break-words t-body-compact text-fg" title={row.nextAction}>{row.nextAction}</span>
        : active ? <span className="t-body-compact text-fg-3">Шаг не задан</span> : <span aria-hidden="true" className="text-fg-3">—</span>}
      {updated ? (
        <span className="block t-meta text-fg-3">обн. <time dateTime={updated.dateTime} className="font-mono tabular-nums">{updated.text}</time></span>
      ) : due ? (
        <span className="flex items-center gap-x-2 whitespace-nowrap t-meta">
          <time dateTime={due.dateTime} className="font-mono tabular-nums text-fg">{due.text}</time>
          {word ? <DueWord view={word} /> : active ? null : <span className="text-fg-3">{due.caption}</span>}
        </span>
      ) : row.nextAction ? <span className="block t-meta text-fg-3">без срока</span> : null}
    </div>
  );
}

export function StageCell({ item }: Readonly<{ item: NextStudentRow }>) {
  return <StageChip label={item.stage} phase={stagePhase("admissions", item.row.pipelineStage)} />;
}

export function CuratorCell({ item }: Readonly<{ item: NextStudentRow }>) {
  const { row } = item;
  const awaiting = row.attentionFlags.includes("awaiting_ack");
  const full = row.currentCuratorDisplayName ?? "Куратор без имени";
  return (
    <span className="block min-w-0 t-body-compact">
      {row.currentCuratorMembershipId ? <span className="block truncate text-fg" title={full}>{row.isMine ? "Вы" : shortPersonName(full)}</span>
        : row.attentionFlags.includes("needs_curator") ? <span className="font-medium text-danger">нужен куратор</span> : <span className="text-fg-3">не назначен</span>}
      {awaiting ? <span className="block font-medium text-warn">ждёт принятия</span> : null}
    </span>
  );
}

const TONE: Readonly<Record<StudentsSignal["tone"], StatusTone>> = { danger: "danger", warn: "warn", muted: "neutral" };

/** Сигналы словами из самой строки 241: просрочки, документы, «нужен ответ»; в «Мои» — ещё исключения куратора. */
export function SignalsCell({ item }: Readonly<{ item: NextStudentRow }>) {
  const { sort, curatorColumn } = useStudentsTable();
  const signals = studentsRowSignals(item.row, { curatorWords: !curatorColumn, overdueStep: sort === "updated" && item.row.state === "active" });
  if (signals.length === 0) return <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">Нет</span></>;
  return <span className="flex max-w-full flex-wrap gap-1">{signals.map((signal) => <StatusBadge key={signal.key} label={signal.text} tone={TONE[signal.tone]} />)}</span>;
}

/** Переход к делу целиком: строка открывает панель, а не дело; на телефоне дело открывает кнопка панели. */
export function CaseLinkCell({ item }: Readonly<{ item: NextStudentRow }>) {
  const table = useStudentsTable();
  return (
    <div className="relative z-10 flex justify-end">
      <Button variant="ghost" size="icon" asChild>
        <Link href={table.caseHref(item.row)} aria-label={`Открыть дело: ${item.name}`} title="Открыть дело"><Icon name="arrow-right" size={18} /></Link>
      </Button>
    </div>
  );
}
