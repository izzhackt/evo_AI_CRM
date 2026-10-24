"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { changePlatformAdmissionsTaskAction } from "@/lib/platform-admissions-task-actions";
import type { PlatformCaseTaskStatus } from "@/lib/platform-admissions-task-contract";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { QueueTask } from "@/lib/v3/task-queue";
import { taskStatus } from "@/lib/v3/wording";

import { DueWord } from "../blocks/DueWord";
import { Initials } from "../blocks/Initials";
import { StatusChip } from "../blocks/StatusChip";
import { DialButton } from "../telephony/DialButton";
import { dueWordOf, queueDue } from "../queue/due-bucket";
import { shortPersonName } from "../queue/person-name";
import { RowSelect } from "../queue/Bulk";
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
    /** Правка срока и исполнителя — и «Перенести срок» выбранных (Э7). */
    edit,
    postpone: edit && !dueTomorrow(task, now),
    transfer: edit && (task.kind === "staff" || permissions.caseAssign),
  };
}

/**
 * Почему выбранная задача не подходит массовому действию: называется настоящая причина (права или роль в задаче),
 * а не одно слово на все случаи. Подходит ли задача, решает `taskRowAbilities`; сервер проверяет каждую сам.
 */
export function taskBulkSkipReason(task: QueueTask, permissions: TaskRowPermissions, action: "complete" | "edit"): string {
  if (action === "complete") return task.kind === "staff" && permissions.staffComplete ? "завершает исполнитель" : "нет права завершать";
  return task.kind === "staff" && permissions.staffEdit ? "меняет автор" : "нет права менять";
}

/**
 * Колонка выбора (Э7): у списка с массовыми действиями отметок нет, пока не
 * нажато «Выбрать» или клавиша «x» (`revealed`): круг выполнения не соседствует
 * с отметкой ни на телефоне, ни на компьютере. С отметками первая колонка шире —
 * отметка и круг рядом; строка, которую сотрудник не может править, держит место
 * пустым: колонки остаются ровными.
 */
export type TaskRowSelect = Readonly<{ available: boolean; checked: boolean; onToggle: () => void; revealed: boolean }>;

const ROW_BUTTON = "relative z-10 grid size-11 shrink-0 place-items-center rounded-full";
/**
 * Точка между частями строки — только от 32rem, где строка не переносится. На узкой строке части переносятся целиком
 * и держатся отступом: точка осталась бы одна в конце или в начале строки.
 */
const SEP = <span aria-hidden="true" className="@max-[32rem]:hidden">·{" "}</span>;
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
  hideStudent = false,
  nowIso,
  permissions,
  recent,
  onCompleted,
  announce,
  select = null,
  leadRef = null,
  dial = null,
  hideTodayWord = false,
}: Readonly<{
  task: QueueTask;
  href: string;
  moveHref: string;
  selected: boolean;
  /** Вид «Открытые». */
  open: boolean;
  showAssignee: boolean;
  /**
   * Строка стоит в деле этого студента (дело студента, «Что дальше»): имя в
   * каждой строке повторяло бы заголовок страницы.
   */
  hideStudent?: boolean;
  /** Момент чтения сервера: одинаковые сроки при рендере и гидрации. */
  nowIso: string;
  permissions: TaskRowPermissions;
  recent: RecentCompletion | null;
  onCompleted: (completion: RecentCompletion) => void;
  announce: (text: string) => void;
  /** Колонка выбора для массовых действий; null — у списка их нет. */
  select?: TaskRowSelect | null;
  /** Лид рабочей задачи («Перезвонить клиенту»): имя клиента в строке; null — у задачи лида нет. */
  leadRef?: Readonly<{ leadId: string; name: string; href: string }> | null;
  /** «Позвонить» у строки с лидом — только когда база открыла набор этому сотруднику (`DialButton`, T7); общая подсказка — у списка. */
  dial?: DialOptions | null;
  /** Строка стоит в группе «Сегодня»: красное слово «сегодня» в каждой строке повторяло бы заголовок группы. */
  hideTodayWord?: boolean;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Синхронный замок от двойного нажатия: `pending` меняется только после
  // рендера, и второй быстрый щелчок успел бы отправить команду ещё раз.
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const result = useAnchoredPopover("start");
  const menu = useAnchoredPopover("end");
  const postpone = useAnchoredPopover("end", { triggerId: menu.triggerId, anchorName: menu.anchorName });
  const now = new Date(nowIso);
  const can = taskRowAbilities(task, permissions, open, now);
  const due = queueDue(task, now, open);
  // Э1.3: срок словом (`DueWord`), инициалы исполнителя, слово-исключение
  // чипом; «Отменить» — у списка строкой в верхнем слое (UndoToast).
  const word = exceptionWord(task, open);
  const done = Boolean(recent);
  // Только что завершённая задача больше не «прошла» и не «сегодня»: слова срока нет.
  const rawDueWord = !done ? dueWordOf(task, now, open) : null;
  const dueWord = hideTodayWord && rawDueWord?.tone === "today" ? null : rawDueWord;
  // «Позвонить» — у открытой задачи с лидом; колонка действий шире на одну кнопку.
  const dialLeadId = leadRef && dial?.status === "ready" && open && !done ? leadRef.leadId : null;

  async function completeStaff() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const state = await mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        staffStatusForm(task, "done"),
      );
      if (state.status === "saved" && state.version) {
        // Круг сменился отметкой; фокус переходит на «Отменить» строки UndoToast списка.
        onCompleted({ task, version: state.version, previousStatus: task.status, expired: false });
        announce(`Задача «${task.title}» завершена.`);
      } else setError(STAFF_ERROR_COPY[state.status] ?? "Не удалось сохранить. Повторите.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { busy.current = false; setPending(false); }
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
    if (busy.current) return;
    busy.current = true;
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
    finally { busy.current = false; setPending(false); }
  }

  function openCasePostpone() {
    document.getElementById(menu.popoverId)?.hidePopover();
    document.getElementById(postpone.popoverId)?.showPopover();
  }

  // Срок — своя колонка сразу перед названием (не у правого края): дата и
  // задача читаются вместе при любой ширине. Исполнитель — колонкой от 48rem.
  // С колонкой выбора ширина первой колонки — переменная `--row-lead`: 5.5rem
  // (отметка и круг), без «Выбрать» — 2.75rem (только круг).
  const selectHidden = select !== null && !select.revealed;
  // Последняя колонка — «⋯» (2.75rem); у строки с «Позвонить» шире на кнопку (`--row-tail`).
  const layout = showAssignee
    ? select ? "@3xl:grid-cols-[var(--row-lead)_7rem_minmax(0,1fr)_minmax(0,11rem)_var(--row-tail)]" : "@3xl:grid-cols-[2.75rem_7rem_minmax(0,1fr)_minmax(0,11rem)_var(--row-tail)]"
    : "";
  const tailVar = dialLeadId ? "[--row-tail:5.5rem]" : "[--row-tail:2.75rem]";
  const [narrow, wide] = select
    ? [`${selectHidden ? "[--row-lead:2.75rem]" : "[--row-lead:5.5rem]"} grid-cols-[var(--row-lead)_minmax(0,1fr)_var(--row-tail)]`, "@min-[32rem]:grid-cols-[var(--row-lead)_7rem_minmax(0,1fr)_var(--row-tail)]"]
    : ["grid-cols-[2.75rem_minmax(0,1fr)_var(--row-tail)]", "@min-[32rem]:grid-cols-[2.75rem_7rem_minmax(0,1fr)_var(--row-tail)]"];
  // Части второй строки: имя (студент, клиент) и «из чата» — до них стоит разделитель; без них строка начинается со срока.
  const person = !hideStudent && ((task.kind === "case" && Boolean(task.studentCaseId)) || leadRef !== null);
  const chat = !hideStudent && task.fromChat && !(task.kind === "case" && task.studentCaseId);
  const before = person || chat;
  // Без имени студента после срока на узкой строке идут только «дело закрыто» и слово-исключение.
  const tail = task.caseState === "closed" || word !== null;
  // Вторая строка без частей не занимает высоты: у обычной рабочей задачи на широкой строке в ней пусто (срок — своя колонка).
  const metaHidden = before || tail ? ""
    : showAssignee ? (due ? " @3xl:hidden" : " @max-[32rem]:hidden @3xl:hidden")
      : due ? " @min-[32rem]:hidden" : " hidden";

  return (
    <li
      data-queue-row={task.key}
      data-kind={task.kind}
      data-selected={select?.checked ? "" : undefined}
      className={`v3-queue-row relative grid ${tailVar} ${narrow} items-center gap-x-2 border-b border-border ${wide} ${layout}${layout ? " " : ""}${selected || select?.checked ? "bg-surface-2" : "hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface"}`}
    >
      <div className="flex">
        {select ? (select.available && !done
          // Отметка остаётся в разметке и скрытой: клавиша «x» отмечает строку, и после неё отметки показываются.
          ? <span className={selectHidden ? "hidden" : "contents"}><RowSelect label={task.title} checked={select.checked} onToggle={select.onToggle} /></span>
          : <span aria-hidden="true" className={`size-11 shrink-0${selectHidden ? " hidden" : ""}`} />) : null}
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
          <time dateTime={due.dateTime} className="block font-mono tabular-nums text-fg">{due.text}</time>
          {/* Слово срока — блок `DueWord` (красный — только у прошедшего срока). */}
          {dueWord ? <span className="flex min-h-6 items-center"><DueWord view={dueWord} /></span>
            : due.caption ? <span className="flex min-h-6 items-center t-meta text-fg-3">{due.caption}</span> : null}
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
          // «Отменить» — строкой списка в верхнем слое (UndoToast).
          <p className="relative z-10 flex w-fit items-center gap-1 t-meta text-fg-2">
            Завершено
          </p>
        ) : (
          <p className={`flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 t-meta text-fg-2 @min-[32rem]:gap-x-1${metaHidden}`}>
            {/* Узкая строка: срок первым, как колонка срока на широкой. Части строки
                переносятся целиком: имя студента не превращается в «Ив…».
                Одна часть, не помещающаяся в строку, сокращается многоточием. */}
            {due ? (
              <span className="shrink-0 @min-[32rem]:hidden">
                <span>
                  {due.caption ? `${due.caption} ` : null}<time dateTime={due.dateTime} className="font-mono tabular-nums">{due.text}</time>{dueWord ? <> <DueWord view={dueWord} /></> : null}
                </span>
              </span>
            ) : null}
            {hideStudent ? null : task.kind === "case" && task.studentCaseId ? <>
              {/* Имя — ссылка на дело только при мыши на широком экране (24 px по
                  высоте, WCAG 2.5.8; открытый вопрос владельцу — DESIGN.md). На
                  телефоне и сенсорном экране это текст: вся строка открывает
                  задачу, а дело — «Открыть дело» в панели. */}
              <Link href={`/v3/profile?case=${encodeURIComponent(task.studentCaseId)}`} title={task.studentDisplayName ?? undefined}
                className="relative z-10 hidden h-6 min-w-0 items-center underline-offset-2 hover:text-fg hover:underline md:pointer-fine:flex">
                <span className="truncate">{task.studentDisplayName}</span>
              </Link>
              <span className="min-w-0 truncate md:pointer-fine:hidden">{task.studentDisplayName}</span>
            </> : leadRef ? <>
              {/* Имя клиента — как имя студента выше: ссылка на карточку только при мыши на широком экране. */}
              <Link href={leadRef.href} title={leadRef.name}
                className="relative z-10 hidden h-6 min-w-0 items-center underline-offset-2 hover:text-fg hover:underline md:pointer-fine:flex">
                <span className="truncate">{leadRef.name}</span>
              </Link>
              <span className="min-w-0 truncate md:pointer-fine:hidden">{leadRef.name}</span>
              {task.fromChat ? <span className="min-w-0 shrink-[2] truncate">{SEP}из чата</span> : null}
            </> : task.fromChat ? <span className="min-w-0 truncate">из чата</span> : null}
            {task.caseState === "closed" ? <span className="min-w-0 truncate">{before ? SEP : null}дело закрыто</span> : null}
            {word ? <span className="shrink-0">{before || task.caseState === "closed" ? SEP : null}<StatusChip label={word} tone={task.status === "blocked" ? "warn" : "neutral"} /></span> : null}
            {/* Без своей колонки (32–48rem: панель открыта рядом) исполнитель
                помечен «исп.» и сокращён — его не спутать со студентом или
                источником; сжимается медленнее имени студента. */}
            {showAssignee ? (
              <span className="hidden min-w-0 shrink-[0.5] truncate @min-[32rem]:inline @3xl:hidden" title={`Исполнитель: ${task.assigneeDisplayName}`}>
                {before || tail ? "· " : null}<span aria-hidden="true">исп. {shortPersonName(task.assigneeDisplayName)}</span><span className="sr-only">исполнитель {task.assigneeDisplayName}</span>
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
        <p className="hidden min-w-0 items-center gap-2 t-body-compact text-fg-2 @3xl:flex" title={task.assigneeDisplayName}>
          <Initials name={task.assigneeDisplayName} decorative />
          <span className="truncate">{task.assigneeDisplayName}</span>
        </p>
      ) : null}

      <div className="flex justify-end">
        {dialLeadId && dial?.status === "ready" ? <DialButton leadId={dialLeadId} mapped={dial.mapped} variant="row" subject={leadRef?.name ?? null} sharedHint /> : null}
        {!done && (can.postpone || can.transfer) ? <>
          <button id={menu.triggerId} type="button" popoverTarget={menu.popoverId} style={menu.triggerStyle}
            aria-label={`Действия: ${task.title}`} className={`${ROW_BUTTON} rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg`}>
            <Icon name="more-horizontal" size={20} />
          </button>
          <div id={menu.popoverId} popover="auto" style={menu.popoverStyle} role="group" aria-label={`Действия: ${task.title}`}
            className="v3-anchored v3-anchored-end w-56 rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg">
            {can.postpone ? (
              <button type="button" className={MENU_ITEM} disabled={pending} onClick={task.kind === "staff" ? () => void postponeStaff() : openCasePostpone}>
                Перенести на завтра
              </button>
            ) : null}
            {/* Строка при смене адреса не пересоздаётся: меню закрывается само. */}
            {can.transfer ? <Link href={moveHref} scroll={false} onClick={() => document.getElementById(menu.popoverId)?.hidePopover()}
              className={MENU_ITEM}>Передать…</Link> : null}
          </div>
        </> : <span aria-hidden="true" className="size-11" />}
      </div>

      {error ? <p role="alert" className={`col-span-full pb-2 t-body-compact text-danger ${select ? selectHidden ? "ps-[3.25rem]" : "ps-[6rem]" : "ps-[3.25rem]"}`}>{error}</p> : null}

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
