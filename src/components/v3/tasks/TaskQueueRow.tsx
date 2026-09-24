"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/icons";
import { changePlatformAdmissionsTaskAction } from "@/lib/platform-admissions-task-actions";
import type { PlatformCaseTaskStatus } from "@/lib/platform-admissions-task-contract";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import type { QueueTask } from "@/lib/v3/task-queue";
import { taskStatus } from "@/lib/v3/wording";

import { queueDue } from "../queue/due-bucket";
import { shortPersonName } from "../queue/person-name";
import { QueueFieldPopover } from "../queue/QueueFieldPopover";
import { useAnchoredPopover } from "../queue/useAnchoredPopover";
import { CASE_ERROR_COPY, STAFF_ERROR_COPY, caseChangeForm, dueTomorrow, staffEditForm, staffStatusForm, tomorrowDeadline } from "./task-commands";

/** Права строки — подсказка интерфейса; каждую команду сервер проверяет сам. */
export type TaskRowPermissions = Readonly<{
  actorMembershipId: string;
  /** Администратор в своём интерфейсе (не просмотр роли). */
  admin: boolean;
  preview: boolean;
  staffComplete: boolean;
  staffEdit: boolean;
  caseManage: boolean;
  caseAssign: boolean;
}>;

export type RecentCompletion = Readonly<{
  task: QueueTask;
  /** Версия после завершения: отмена возвращает прежнее состояние именно от неё. */
  version: string;
  previousStatus: PlatformCaseTaskStatus;
  /** Время «Отменить» вышло; строка ждёт обновления списка. */
  expired: boolean;
}>;

/**
 * Рабочую задачу завершает её исполнитель или Admin (правило `staff.task.complete`
 * владельца), правит — автор или Admin (`staff.task.edit`). Задачу по студенту
 * очередь отдаёт только тем, кто может её вести (`task.manage`).
 */
export function taskRowAbilities(task: QueueTask, permissions: TaskRowPermissions, open: boolean, now: Date) {
  const live = open && !permissions.preview;
  const ownsStaff = permissions.admin || task.assigneeMembershipId === permissions.actorMembershipId;
  const authorStaff = permissions.admin || task.creatorMembershipId === permissions.actorMembershipId;
  const complete = live && (task.kind === "staff" ? permissions.staffComplete && ownsStaff : permissions.caseManage);
  const edit = live && (task.kind === "staff" ? permissions.staffEdit && authorStaff : permissions.caseManage);
  return {
    complete,
    postpone: edit && !dueTomorrow(task, now),
    transfer: edit && (task.kind === "staff" || permissions.caseAssign),
  };
}

const ROW_BUTTON = "relative z-10 grid size-11 shrink-0 place-items-center rounded-full";
const MENU_ITEM = "flex min-h-11 w-full items-center rounded-nav px-3 text-start t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/** Слово состояния — только исключение: заблокирована, отменена; выполненная — в открытом виде. */
function exceptionWord(task: QueueTask, open: boolean): string | null {
  if (task.status === "blocked" || task.status === "cancelled" || (open && task.status === "done")) return taskStatus(task.status);
  return null;
}

export function TaskQueueRow({
  task,
  href,
  moveHref,
  selected,
  open,
  showAssignee,
  nowIso,
  permissions,
  recent,
  onCompleted,
  onUndo,
  announce,
}: Readonly<{
  task: QueueTask;
  href: string;
  moveHref: string;
  selected: boolean;
  /** Вид «Открытые». */
  open: boolean;
  showAssignee: boolean;
  /** Момент чтения сервера: одинаковые сроки при рендере и гидрации. */
  nowIso: string;
  permissions: TaskRowPermissions;
  recent: RecentCompletion | null;
  onCompleted: (completion: RecentCompletion) => void;
  onUndo: (completion: RecentCompletion) => Promise<string | null>;
  announce: (text: string) => void;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = useAnchoredPopover("start");
  const menu = useAnchoredPopover("end");
  const postpone = useAnchoredPopover("end", { triggerId: menu.triggerId, anchorName: menu.anchorName });
  const now = new Date(nowIso);
  const can = taskRowAbilities(task, permissions, open, now);
  const due = queueDue(task, now, open);
  const word = exceptionWord(task, open);
  const done = Boolean(recent);
  const undoId = `${result.triggerId}-undo`;

  async function completeStaff() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const state = await mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        staffStatusForm(task, "done"),
      );
      if (state.status === "saved" && state.version) {
        onCompleted({ task, version: state.version, previousStatus: task.status, expired: false });
        announce(`Задача «${task.title}» завершена.`);
        // Круг сменился отметкой: фокус переходит на «Отменить» в той же строке.
        requestAnimationFrame(() => document.getElementById(undoId)?.focus());
      } else setError(STAFF_ERROR_COPY[state.status] ?? "Не удалось сохранить. Повторите.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { setPending(false); }
  }

  async function changeCase(change: Parameters<typeof caseChangeForm>[1], saved: string): Promise<string | null> {
    if (task.kind !== "case" || !task.studentCaseId || task.studentVisible === null) return CASE_ERROR_COPY.invalid;
    const state = await changePlatformAdmissionsTaskAction(
      { status: "idle", requestId: crypto.randomUUID(), caseTaskId: null, version: null, changedAt: null },
      caseChangeForm({ ...task, studentCaseId: task.studentCaseId, studentVisible: task.studentVisible }, change),
    );
    if (state.status !== "saved") return CASE_ERROR_COPY[state.status] ?? "Не удалось сохранить. Повторите.";
    announce(saved);
    router.refresh();
    return null;
  }

  async function postponeStaff() {
    document.getElementById(menu.popoverId)?.hidePopover();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const state = await mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        staffEditForm(task, { deadline: tomorrowDeadline(task, new Date()) }),
      );
      if (state.status === "saved") { announce(`Задача «${task.title}» перенесена на завтра.`); router.refresh(); }
      else setError(STAFF_ERROR_COPY[state.status] ?? "Не удалось сохранить. Повторите.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { setPending(false); }
  }

  function openCasePostpone() {
    document.getElementById(menu.popoverId)?.hidePopover();
    document.getElementById(postpone.popoverId)?.showPopover();
  }

  // Срок — своя колонка сразу перед названием (не у правого края): дата и
  // задача читаются вместе при любой ширине. Исполнитель — колонкой от 48rem.
  const layout = showAssignee ? "@3xl:grid-cols-[2.75rem_7rem_minmax(0,1fr)_minmax(0,11rem)_2.75rem]" : "";
  const caption = due ? due.word ?? due.caption : null;

  return (
    <li
      data-queue-row={task.key}
      data-kind={task.kind}
      className={`relative grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-x-2 border-b border-border @min-[32rem]:grid-cols-[2.75rem_7rem_minmax(0,1fr)_2.75rem] ${layout}${layout ? " " : ""}${selected ? "bg-surface-2" : "hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface"}`}
    >
      <div className="flex">
        {done ? (
          <span className={`${ROW_BUTTON} text-ok`}><Icon name="circle-check" size={22} /></span>
        ) : can.complete && task.kind === "staff" ? (
          <button id={result.triggerId} type="button" onClick={completeStaff} disabled={pending} aria-label={`Завершить: ${task.title}`}
            className={`group ${ROW_BUTTON} text-fg-3 hover:text-ok focus-visible:text-ok disabled:text-fg-3`}>
            <Icon name="circle" size={22} className="group-hover:hidden group-focus-visible:hidden" />
            <Icon name="circle-check" size={22} className="hidden group-hover:block group-focus-visible:block" />
          </button>
        ) : can.complete ? (
          <button id={result.triggerId} type="button" popoverTarget={result.popoverId} style={result.triggerStyle}
            aria-haspopup="dialog" aria-label={`Завершить с результатом: ${task.title}`}
            className={`group ${ROW_BUTTON} text-fg-3 hover:text-ok focus-visible:text-ok`}>
            <Icon name="circle" size={22} className="group-hover:hidden group-focus-visible:hidden" />
            <Icon name="circle-check" size={22} className="hidden group-hover:block group-focus-visible:block" />
          </button>
        ) : !open ? (
          <span className={`${ROW_BUTTON} text-fg-3`}>
            <Icon name={task.status === "done" ? "circle-check" : "circle"} size={22} />
            {task.status === "done" ? <span className="sr-only">{taskStatus(task.status)}</span> : null}
          </span>
        ) : <span aria-hidden="true" className="size-11" />}
      </div>

      {/* Первая строка даты стоит на одной линии с названием, слово — с «студент · …». */}
      <p className="hidden self-start pt-1 t-body-compact @min-[32rem]:block">
        {due ? <>
          {/* «24.09 14:30» помещается в 7rem; редкое «03.01.27 14:00» переносит время, а не наезжает на название. */}
          <time dateTime={due.dateTime} className={`block font-mono tabular-nums ${due.overdue ? "text-danger" : "text-fg"}`}>{due.text}</time>
          {caption ? <span className={`flex min-h-6 items-center t-meta ${due.overdue ? "text-danger" : "text-fg-3"}`}>{caption}</span> : null}
        </> : null}
      </p>

      <div className="min-w-0 py-0.5">
        <Link
          href={href}
          scroll={false}
          data-queue-open=""
          aria-current={selected ? "true" : undefined}
          title={task.title}
          className={`line-clamp-2 break-words py-0.5 t-item before:absolute before:inset-0 before:content-[''] hover:underline @min-[32rem]:line-clamp-1 ${done ? "text-fg-3 line-through" : "text-fg"}`}
        >
          {task.title}
        </Link>
        {done && recent ? (
          <p className="relative z-10 flex w-fit items-center gap-1 t-meta text-fg-2">
            Завершено
            {!recent.expired ? <>
              {" · "}
              <button id={undoId} type="button" onClick={() => void onUndo(recent).then((failure) => {
                setError(failure);
                if (!failure) requestAnimationFrame(() => document.getElementById(result.triggerId)?.focus());
              })}
                className="relative inline-flex min-h-6 items-center t-caption text-fg underline underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] hover:text-accent-text">
                Отменить
              </button>
            </> : null}
          </p>
        ) : (
          <p className="flex min-h-6 min-w-0 items-center gap-x-1 overflow-hidden whitespace-nowrap t-meta text-fg-2 @min-[32rem]:overflow-visible">
            {/* Узкая строка: срок первым, как колонка срока на широкой. Срок и
                слово-исключение не сжимаются; имя студента, «Рабочая» и «из чата»
                сокращаются многоточием. Крайний случай обрезается у края: на узкой
                ширине в строке нет ссылок, и рамке фокуса обрезаться нечему. */}
            {due ? (
              <span className="shrink-0 @min-[32rem]:hidden">
                <span className={due.overdue ? "text-danger" : undefined}>
                  {due.caption ? `${due.caption} ` : null}<time dateTime={due.dateTime} className="font-mono tabular-nums">{due.text}</time>{due.word ? ` ${due.word}` : null}
                </span> ·
              </span>
            ) : null}
            {task.kind === "case" && task.studentCaseId ? <>
              {/* Имя — ссылка на дело только при мыши на широком экране (24 px по
                  высоте, WCAG 2.5.8; открытый вопрос владельцу — DESIGN.md). На
                  телефоне и сенсорном экране это текст: вся строка открывает
                  задачу, а дело — «Открыть дело» в панели. */}
              <Link href={`/v3/profile?case=${encodeURIComponent(task.studentCaseId)}`} title={task.studentDisplayName ?? undefined}
                className="relative z-10 hidden h-6 min-w-0 items-center underline-offset-2 hover:text-fg hover:underline md:pointer-fine:flex">
                <span className="truncate">{task.studentDisplayName}</span>
              </Link>
              <span className="min-w-0 truncate md:pointer-fine:hidden">{task.studentDisplayName}</span>
            </> : <>
              <span className="min-w-0 truncate">Рабочая</span>
              {task.fromChat ? <span className="min-w-0 shrink-[2] truncate">· из чата</span> : null}
            </>}
            {task.caseState === "closed" ? <span className="min-w-0 truncate">· дело закрыто</span> : null}
            {word ? <span className={`shrink-0 ${task.status === "blocked" ? "text-warn" : "text-fg-3"}`}>· {word}</span> : null}
            {/* Без своей колонки (32–48rem: панель открыта рядом) исполнитель
                помечен «исп.» и сокращён — его не спутать со студентом или
                источником; сжимается медленнее имени студента. */}
            {showAssignee ? (
              <span className="hidden min-w-0 shrink-[0.5] truncate @min-[32rem]:inline @3xl:hidden" title={`Исполнитель: ${task.assigneeDisplayName}`}>
                · <span aria-hidden="true">исп. {shortPersonName(task.assigneeDisplayName)}</span><span className="sr-only">исполнитель {task.assigneeDisplayName}</span>
              </span>
            ) : null}
          </p>
        )}
        {/* Телефон: строке «срок · студент» не хватает места — исполнитель своей строкой, полным именем. */}
        {showAssignee && !done ? (
          <p className="truncate pb-1 t-meta text-fg-2 @min-[32rem]:hidden" title={`Исполнитель: ${task.assigneeDisplayName}`}>
            <span aria-hidden="true">исп.</span><span className="sr-only">исполнитель</span> {task.assigneeDisplayName}
          </p>
        ) : null}
      </div>

      {showAssignee ? (
        <p className="hidden truncate t-body-compact text-fg-2 @3xl:block" title={task.assigneeDisplayName}>{task.assigneeDisplayName}</p>
      ) : null}

      <div className="flex justify-end">
        {!done && (can.postpone || can.transfer) ? <>
          <button id={menu.triggerId} type="button" popoverTarget={menu.popoverId} style={menu.triggerStyle}
            aria-label={`Действия: ${task.title}`} className={`${ROW_BUTTON} rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg`}>
            <Icon name="more-horizontal" size={20} />
          </button>
          <div id={menu.popoverId} popover="auto" style={menu.popoverStyle} aria-label={`Действия: ${task.title}`}
            className="v3-anchored v3-anchored-end w-56 rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg">
            {can.postpone ? (
              <button type="button" className={MENU_ITEM} disabled={pending} onClick={task.kind === "staff" ? () => void postponeStaff() : openCasePostpone}>
                Перенести на завтра
              </button>
            ) : null}
            {can.transfer ? <Link href={moveHref} scroll={false} className={MENU_ITEM}>Передать…</Link> : null}
          </div>
        </> : <span aria-hidden="true" className="size-11" />}
      </div>

      {error ? <p role="alert" className="col-span-full pb-2 ps-[3.25rem] t-body-compact text-danger">{error}</p> : null}

      {task.kind === "case" && can.complete ? (
        <QueueFieldPopover
          popover={{ id: result.popoverId, style: result.popoverStyle }}
          label="Результат"
          placeholder="Что сделано"
          submitLabel="Завершить"
          emptyError="Напишите результат: без него задача по студенту не завершается."
          onSubmit={(value) => changeCase({ status: "done", reason: value }, `Задача «${task.title}» завершена.`)}
        />
      ) : null}
      {task.kind === "case" && can.postpone ? (
        <QueueFieldPopover
          popover={{ id: postpone.popoverId, style: postpone.popoverStyle }}
          label="Причина переноса"
          returnFocusId={menu.triggerId}
          submitLabel="Перенести на завтра"
          emptyError="Напишите причину: без неё срок задачи по студенту не меняется."
          onSubmit={(value) => changeCase({ deadline: tomorrowDeadline(task, new Date()), reason: value }, `Задача «${task.title}» перенесена на завтра.`)}
        />
      ) : null}
    </li>
  );
}
