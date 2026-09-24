import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import type { TaskQueue, TaskQueueFilters } from "@/lib/v3/task-queue";
import { taskQueueParams, TASK_QUEUE_WINDOWS } from "@/lib/v3/task-queue";

import { DUE_BUCKETS, DUE_FILTER_LABELS, dueBandLabel, type DueFilter } from "../queue/due-bucket";
import { FilterMenu } from "../queue/FilterMenu";
import { activeFilterCount, queueHref } from "../queue/queue-url";
import { QueueEmpty, QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { QueueToolbar } from "../queue/QueueToolbar";
import { QueueViewTabs, type QueueTab } from "../queue/QueueViewTabs";
import { TaskQueueList } from "./TaskQueueList";
import type { TaskRowPermissions } from "./TaskQueueRow";
import { TaskQuickAdd } from "./TaskQuickAdd";

const EMPTY_DUE: Readonly<Record<DueFilter, string>> = {
  overdue: "Просроченных задач нет",
  today: "На сегодня задач нет",
  tomorrow: "На завтра задач нет",
  week: "На этой неделе задач нет",
  later: "Задач на потом нет",
  none: "Задач без срока нет",
};

type Href = (overrides?: Record<string, string | null>) => string;

/** Пустой список говорит, что именно пусто, и предлагает одно подходящее действие. */
export function taskQueueEmptyState(filters: TaskQueueFilters, href: Href) {
  if (filters.query) return { title: "Ничего не найдено", action: { label: "Сбросить поиск", href: href({ q: null }) } };
  if (filters.state === "done") return { title: "Завершённых задач нет", action: { label: "Показать открытые", href: href({ status: null }) } };
  if (filters.due) return { title: EMPTY_DUE[filters.due], action: { label: "Показать все открытые", href: href({ due: null }) } };
  if (filters.type) return { title: filters.type === "case" ? "Открытых задач по студентам нет" : "Открытых рабочих задач нет", action: { label: "Показать все типы", href: href({ type: null }) } };
  return { title: "Открытых задач нет", action: null };
}

/**
 * «Задачи» (25.09.2026) — одна рабочая очередь: вкладки «Мои · Поставил я ·
 * Вся команда», одна строка инструментов, строка «Новая задача…», группы по
 * сроку и правая панель. Компонент чистый: данные и права читает страница.
 */
export function TasksWorkspace({
  filters,
  queue,
  day,
  nowIso,
  canReadStaffTasks,
  canReadCaseTasks,
  teamView,
  createdExcludesCases,
  composer,
  composerKey,
  canCreate,
  urlIntent,
  permissions,
  selectedKey,
  panel,
}: Readonly<{
  filters: TaskQueueFilters;
  queue: TaskQueue;
  /** Сегодня в Бишкеке, YYYY-MM-DD. */
  day: string;
  /** Момент чтения сервера. */
  nowIso: string;
  canReadStaffTasks: boolean;
  canReadCaseTasks: boolean;
  teamView: boolean;
  createdExcludesCases: boolean;
  composer: ComponentProps<typeof TaskQuickAdd>["composer"];
  composerKey: string;
  canCreate: boolean;
  urlIntent: string | null;
  permissions: TaskRowPermissions;
  selectedKey: string | null;
  /** Панель выбранной задачи (читает страница) или null. */
  panel: ReactNode;
}>) {
  const listParams = taskQueueParams(filters);
  const listHref: Href = (overrides = {}) => queueHref("/v3/tasks", listParams, overrides);
  const canReadTaskQueue = canReadStaffTasks || canReadCaseTasks;
  const tabs: QueueTab[] = [
    { key: "mine", label: "Мои", href: listHref({ view: null }), count: queue.counts.mine, current: filters.view === "mine" },
    ...(canReadStaffTasks ? [{ key: "created", label: "Поставил я", href: listHref({ view: "created" }), count: queue.counts.created, current: filters.view === "created" }] : []),
    ...(teamView ? [{ key: "all", label: "Вся команда", href: listHref({ view: "all" }), count: queue.counts.all, current: filters.view === "all" }] : []),
  ];
  const filterMenus = <>
    {filters.state === "open" ? <FilterMenu
      label="Срок"
      valueLabel={filters.due ? DUE_FILTER_LABELS[filters.due] : null}
      clearHref={listHref({ due: null })}
      options={[{ key: "all", label: "Любой срок", href: listHref({ due: null }), selected: filters.due === null },
        ...DUE_BUCKETS.map((bucket) => ({ key: bucket, label: DUE_FILTER_LABELS[bucket], href: listHref({ due: bucket }), selected: filters.due === bucket }))]}
    /> : null}
    {canReadStaffTasks && canReadCaseTasks ? <FilterMenu
      label="Тип"
      valueLabel={filters.type === "case" ? "По студентам" : filters.type === "staff" ? "Рабочие" : null}
      clearHref={listHref({ type: null })}
      options={[
        { key: "all", label: "Все", href: listHref({ type: null }), selected: filters.type === null },
        { key: "case", label: "По студентам", href: listHref({ type: "case" }), selected: filters.type === "case" },
        { key: "staff", label: "Рабочие", href: listHref({ type: "staff" }), selected: filters.type === "staff" },
      ]}
    /> : null}
    <FilterMenu
      label="Состояние"
      valueLabel={filters.state === "done" ? "Завершённые" : "Открытые"}
      clearHref={filters.state === "done" ? listHref({ status: null }) : null}
      options={[
        { key: "open", label: "Открытые", href: listHref({ status: null }), selected: filters.state === "open" },
        { key: "done", label: "Завершённые", href: listHref({ status: "done", due: null }), selected: filters.state === "done" },
      ]}
    />
  </>;
  const active = activeFilterCount([filters.type, filters.due, filters.query, filters.state === "done" ? "done" : null]);
  const empty = taskQueueEmptyState(filters, listHref);
  const nextWindow = TASK_QUEUE_WINDOWS.find((value) => value > filters.window);
  const bands = queue.bands.map((band) => ({
    key: band.bucket,
    label: band.bucket === "past" ? "Завершённые и отменённые" : dueBandLabel(band.bucket, day),
    count: queue.complete ? band.rows.length : null,
    danger: band.bucket === "overdue",
    rows: band.rows,
  }));

  return (
    <div className={panel ? "xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-6" : undefined}>
      {/*
        THESIS: день менеджера, а не устройство базы — одна очередь рабочих
        задач и задач по студентам, сгруппированная по сроку; «что просрочено и
        что сегодня» видно без чтения правого края каждой строки.
        OWN-WORLD: рабочий стол EVO — серая земля #f3f3f3, строки на волосяных
        линиях #dedede без карточек, Golos Text; сроки — JetBrains Mono «ДД.ММ»;
        выбранное — .v3-choice; сплошной красный #d70217 только у «Создать
        задачу» в верхней панели; подтверждения — тёмные нейтральные.
        STORY: сотрудник открывает «Мои», видит «Просрочено · 2» и «Сегодня»,
        закрывает рабочую задачу кругом слева (6 секунд на «Отменить»), задачу
        по студенту — с одним полем «Результат», открывает строку — панель
        справа сдвигает список, не закрывая его.
        FIRST VIEWPORT: 1440×900 — H1 «Задачи» с числом, вкладки, одна строка
        инструментов, «Новая задача…», затем группы по сроку: строки по 53 px
        (название и «студент · срок» по 24 px — цели нажатия WCAG 2.5.8, круг
        44 px), видно семь задач под заголовками трёх групп.
      */}
      <div className="min-w-0 space-y-3" data-testid="task-queue">
        {canReadTaskQueue && tabs.length > 1 ? <QueueViewTabs label="Чьи задачи" tabs={tabs} /> : null}
        {canReadTaskQueue ? <QueueToolbar
          search={{ action: "/v3/tasks", name: "q", defaultValue: filters.query, placeholder: "Задача или студент", label: "Найти задачу",
            hidden: { ...listParams, q: null } }}
          filters={filterMenus}
          activeCount={active}
          resetHref={active ? listHref({ type: null, due: null, q: null, status: null, window: null }) : null}
        /> : null}
        {createdExcludesCases ? <p className="t-body-compact text-fg-2">Здесь только рабочие задачи: автор задач по студентам в общем списке не читается.</p> : null}
        <div className="@container min-w-0">
          <TaskQuickAdd key={composerKey} composer={composer} showRow={canCreate} urlIntent={urlIntent} />
          {!canReadTaskQueue ? <p role="status" className="border-b border-border py-8 t-body-compact text-fg-2">
            В вашей роли нет права на просмотр задач.
            {canCreate ? " Новую задачу можно создать строкой выше." : null}
          </p> : queue.rows.length === 0 ? <QueueEmpty
            title={empty.title}
            action={empty.action ? <Link href={empty.action.href} scroll={false} className={QUEUE_QUIET_LINK}>{empty.action.label}</Link> : null}
          /> : <TaskQueueList
            bands={bands}
            open={filters.state === "open"}
            openKey={selectedKey}
            listParams={listParams}
            showAssignee={filters.view !== "mine"}
            nowIso={nowIso}
            permissions={permissions}
          />}
        </div>
        {canReadTaskQueue && !queue.complete ? <p role="status" className="flex flex-wrap items-center gap-x-4 t-body-compact text-fg-2">
          Показаны не все задачи: список больше, чем читается за один раз, и числа скрыты.
          {nextWindow ? <Link href={listHref({ window: String(nextWindow) })} scroll={false} className={QUEUE_QUIET_LINK}>Показать больше задач</Link>
            : <span>Сузьте вид, тип или срок.</span>}
        </p> : null}
      </div>
      {panel}
    </div>
  );
}
