"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import type {
  CaseNextActionReceipt,
  StudentCaseQueueCounts,
  StudentCaseQueueRow,
} from "@/lib/platform-student-case-queue-contract";

import { QueueEmpty, QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { useQueueKeyboard } from "../queue/useQueueKeyboard";
import { StudentQuickView, StudentQuickViewMissing } from "./StudentQuickView";
import { StudentsQueueTable } from "./StudentsQueueTable";
import {
  STUDENTS_QUEUE_PAGE_SIZE,
  STUDENTS_VIEW_LABELS,
  bishkekNoon,
  caseNextActionBand,
  nextStepAccess,
  studentsBands,
  studentsCaseHref,
  studentsListHref,
  studentsQueueHref,
  type NextStepAccessInput,
  type StudentsOpenTasks,
  type StudentsQueueParams,
  type StudentsQueueView,
} from "./students-queue-view";

type Empty = Readonly<{ title: string; action: Readonly<{ label: string; href: string }> | null }>;

/**
 * Пустой список говорит, что именно пусто, и предлагает одно действие.
 * «Все в работе · N» — только если число прочитано.
 */
export function studentsEmptyState(params: StudentsQueueParams, counts: StudentCaseQueueCounts | null): Empty {
  const filtered = Boolean(params.query || params.direction || params.curator || params.stage);
  if (params.cursor) return { title: "На этой странице дел нет", action: { label: "К началу списка", href: studentsQueueHref(params, { cursor: null, open: null }) } };
  if (filtered) return { title: "Ничего не найдено", action: { label: "Сбросить фильтры", href: studentsListHref(params, { query: null, direction: null, curator: null, stage: null }) } };
  const active = { label: counts ? `Все в работе · ${counts.views.active}` : "Все в работе", href: studentsListHref(params, { view: "active" }) };
  switch (params.view as StudentsQueueView) {
    case "mine": return { title: "Активных дел у вас нет", action: active };
    case "needs_action": return { title: "Дел, требующих действия, нет", action: active };
    case "needs_curator": return { title: "У всех дел есть куратор", action: active };
    case "closed": return { title: "Закрытых дел нет", action: null };
    default: return { title: "Дел в работе нет", action: null };
  }
}

/**
 * Тело очереди «Студентов» в браузере: таблица по группам срока, страницы,
 * клавиатура и «Быстрый просмотр». После сохранения шага строка сразу
 * встаёт в свою группу по тому же правилу дня, что у SQL, а числа групп
 * скрываются до ответа сервера (`router.refresh`) — не выдумываются.
 */
export function StudentsQueueBody({
  head,
  params,
  rows,
  counts,
  today,
  nextCursor,
  editor,
  recordScopes,
  openTasks,
  createTask,
  requestId,
}: Readonly<{
  /** Вкладки, строка инструментов и заметки над таблицей (рисует сервер). */
  head: ReactNode;
  params: StudentsQueueParams;
  rows: readonly StudentCaseQueueRow[];
  counts: StudentCaseQueueCounts | null;
  /** Сегодня в Бишкеке из чтения 241. */
  today: string;
  nextCursor: string | null;
  editor: NextStepAccessInput;
  /** Области `record` по делам: такие дела редактор тоже может править. */
  recordScopes: readonly string[];
  /** Открытые задачи дела в панели (читает сервер только при `open`). */
  openTasks: StudentsOpenTasks | null;
  /** Можно ли создать задачу по делу из панели. */
  createTask: boolean;
  requestId: string;
}>) {
  const router = useRouter();
  const openKey = params.open;
  const now = bishkekNoon(today);
  useQueueKeyboard({ openKey });

  // Сохранённый шаг — сразу в строке, до ответа сервера; с новым чтением уходит.
  const [saved, setSaved] = useState<StudentCaseQueueRow | null>(null);
  const [seenRows, setSeenRows] = useState(rows);
  // Строка панели, если после сохранения она ушла с этой страницы.
  const [kept, setKept] = useState<StudentCaseQueueRow | null>(rows.find((row) => row.studentCaseId === openKey) ?? null);
  if (seenRows !== rows) {
    setSeenRows(rows);
    const fresh = rows.find((row) => row.studentCaseId === openKey) ?? null;
    setKept(fresh ?? (saved?.studentCaseId === openKey ? saved : kept?.studentCaseId === openKey ? kept : null));
    setSaved(null);
  }
  const shownRows = saved ? rows.map((row) => row.studentCaseId === saved.studentCaseId ? saved : row) : rows;
  const openRow = openKey === null ? null
    : shownRows.find((row) => row.studentCaseId === openKey) ?? (kept?.studentCaseId === openKey ? kept : null);

  function onSaved(receipt: CaseNextActionReceipt) {
    const base = (saved?.studentCaseId === receipt.studentCaseId ? saved : null)
      ?? rows.find((row) => row.studentCaseId === receipt.studentCaseId)
      ?? (kept?.studentCaseId === receipt.studentCaseId ? kept : null);
    if (!base) { router.refresh(); return; }
    const next: StudentCaseQueueRow = {
      ...base,
      nextAction: receipt.nextAction,
      nextActionDueOn: receipt.nextActionDueOn,
      admissionsVersion: receipt.admissionsVersion,
      dueBand: caseNextActionBand(receipt.nextAction, receipt.nextActionDueOn, now),
    };
    setSaved(next);
    setKept(next);
    router.refresh();
  }

  // Пока сохранённая строка не пришла с сервера, числа групп не показываем:
  // строка уже перешла в другую группу, а числа ещё старые.
  const bands = studentsBands(shownRows, params.sort, today, saved ? null : counts);
  const returnTo = (caseId: string) => studentsQueueHref(params, { open: caseId });
  const links = (row: StudentCaseQueueRow) => ({
    open: studentsQueueHref(params, { open: row.studentCaseId }),
    case: studentsCaseHref(row.studentCaseId, { returnTo: returnTo(row.studentCaseId) }),
  });
  const closeHref = studentsQueueHref(params, { open: null });
  const caption = `${STUDENTS_VIEW_LABELS[params.view as StudentsQueueView]}: ${rows.length} на этой странице`;
  const empty = rows.length === 0 ? studentsEmptyState(params, counts) : null;
  const panel = openKey === null ? null : openRow ? (
    <StudentQuickView
      key={openRow.studentCaseId}
      row={openRow}
      today={today}
      now={now}
      access={nextStepAccess(editor, openRow, recordScopes)}
      tasks={openTasks}
      requestId={requestId}
      onSaved={onSaved}
      links={{
        close: closeHref,
        case: studentsCaseHref(openRow.studentCaseId, { returnTo: returnTo(openRow.studentCaseId) }),
        documents: studentsCaseHref(openRow.studentCaseId, { tab: "documents", returnTo: returnTo(openRow.studentCaseId) }),
        tasks: `${studentsCaseHref(openRow.studentCaseId, { returnTo: returnTo(openRow.studentCaseId) })}#case-tasks`,
        createTask: createTask ? `/v3/tasks?create=case&case=${encodeURIComponent(openRow.studentCaseId)}` : null,
        task: (taskId) => `/v3/tasks?task=${encodeURIComponent(taskId)}&kind=case&case=${encodeURIComponent(openRow.studentCaseId)}`,
      }}
    />
  ) : <StudentQuickViewMissing closeHref={closeHref} caseHref={studentsCaseHref(openKey, { returnTo: closeHref })} />;

  return (
    <div className={panel ? "xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-6" : undefined}>
      {/*
        THESIS: утро куратора, а не справочник дел — одна очередь «что
        просрочено и что сегодня», сгруппированная по сроку «Следующего шага»;
        шаг правится рядом со списком, список не уходит.
        OWN-WORLD: рабочий стол EVO — серая земля #f3f3f3, строки на
        волосяных линиях #dedede без карточек, Golos Text; сроки — JetBrains
        Mono «ДД.ММ»; выбранное — .v3-choice; сплошной красный #d70217 только
        у «Создать задачу» в верхней панели; подтверждения — тёмные нейтральные.
        STORY: куратор открывает «Мои», видит «Просрочено · 3» и «Сегодня»,
        щёлкает строку — справа «Быстрый просмотр», меняет шаг и срок, строка
        переходит в свою группу; «Открыть дело» — Student 360 с возвратом.
        FIRST VIEWPORT: 1440×900 — H1 «Студенты» с числом, вкладки видов,
        одна строка инструментов, шапка колонок и группы по сроку: строки по
        53 px, не меньше десяти дел в первом экране.
      */}
      <div className="min-w-0 space-y-3" data-testid="v3-student-case-directory">
        {head}
        <div className="@container/students min-w-0" data-queue-list="">
          {empty ? (
            <QueueEmpty
              title={empty.title}
              action={empty.action ? <Link href={empty.action.href} scroll={false} className={QUEUE_QUIET_LINK}>{empty.action.label}</Link> : null}
            />
          ) : (
            <StudentsQueueTable
              bands={bands}
              caption={caption}
              hint={!editor.preview && (editor.admin || editor.routeManage) ? "откройте строку и добавьте шаг" : null}
              now={now}
              selectedKey={openKey}
              links={links}
            />
          )}
        </div>
        {params.cursor || nextCursor ? (
          <nav aria-label="Страницы списка студентов" className="flex flex-wrap items-center gap-x-6">
            {params.cursor ? <Link className={QUEUE_QUIET_LINK} scroll={false} href={studentsQueueHref(params, { cursor: null, open: null })}><Icon name="arrow-left" size={16} />К началу</Link> : null}
            {nextCursor ? <Link className={QUEUE_QUIET_LINK} rel="next" href={studentsQueueHref(params, { cursor: nextCursor, open: null })}>Следующие {STUDENTS_QUEUE_PAGE_SIZE}<Icon name="arrow-right" size={16} /></Link> : null}
          </nav>
        ) : null}
      </div>
      {panel}
    </div>
  );
}
