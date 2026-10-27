import Link from "next/link";
import type { ComponentProps } from "react";

import { EmptyState, PageShell, SectionTabs, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { TaskQueue, TaskQueueFilters, TaskQueueKind } from "@/lib/v3/task-queue";

import type { TaskRowPermissions } from "../TaskQueueRow";
import { NewTaskButton } from "./NewTaskButton";
import { TaskLeadCards, TaskMessageCard, type TaskLeadCardData } from "./TaskSourceCards";
import { TasksTable } from "./TasksTable";
import { taskFilterBar } from "./task-filter-menus";
import { taskListView } from "./task-list-view";
import type { TaskSheetData } from "./task-sheet-data";
import type { TaskLead } from "./task-table-model";

export type TasksNextProps = Readonly<{
  filters: TaskQueueFilters;
  queue: TaskQueue;
  cutOff: readonly TaskQueueKind[];
  day: string;
  nowIso: string;
  canReadStaffTasks: boolean;
  canReadCaseTasks: boolean;
  teamView: boolean;
  createdExcludesCases: boolean;
  composer: ComponentProps<typeof NewTaskButton>["composer"];
  composerKey: string;
  canCreate: boolean;
  urlIntent: string | null;
  permissions: TaskRowPermissions;
  taskLeads: Readonly<Record<string, TaskLead>> | null;
  dial: DialOptions | null;
  /** Число в заголовке — только когда его честно дало чтение (так же, как у прежнего вида). */
  count: number | null;
  sheet: TaskSheetData | null;
  closeHref: string;
  moveOpen: boolean;
  sourceMessage: ComponentProps<typeof TaskMessageCard>["message"] | null;
  sourceLead: TaskLeadCardData | null;
  leadTasks: ComponentProps<typeof TaskLeadCards>["links"];
}>;

/**
 * «Задачи» в «Новом виде»: шапка (число, «?» и красная «Новая задача»), вкладки видов («Мои · Поставил я · Вся
 * команда»), таблица с фильтрами и панелью задачи. Чтения, права, команды и адреса — прежние (страница
 * `/v3/tasks`); меняется вид. Пояснения, которые были на экране, — за «?» шапки.
 */
export function TasksNext(props: TasksNextProps) {
  const { filters, queue } = props;
  if (props.sourceLead) {
    return (
      <PageShell title="Задачи" testId="v3-tasks-next">
        <TaskLeadCards lead={props.sourceLead} links={props.leadTasks} composer={props.composer} urlIntent={props.urlIntent} />
      </PageShell>
    );
  }
  const view = taskListView(filters, queue, props.cutOff, props.day);
  const canRead = props.canReadStaffTasks || props.canReadCaseTasks;
  const tabs = [
    { key: "mine", label: "Мои", href: view.listHref({ view: null }), count: queue.counts.mine },
    ...(props.canReadStaffTasks ? [{ key: "created", label: "Поставил я", href: view.listHref({ view: "created" }), count: queue.counts.created }] : []),
    ...(props.teamView ? [{ key: "all", label: "Вся команда", href: view.listHref({ view: "all" }), count: queue.counts.all }] : []),
  ];
  return (
    <PageShell
      title="Задачи"
      count={props.count}
      testId="v3-tasks-next"
      help={<>
        Рабочие задачи и задачи по студентам — одним списком, по сроку. Круг слева завершает рабочую задачу на месте;
        задача по студенту завершается в панели с результатом. Строка открывает панель задачи.
        {props.createdExcludesCases ? " Здесь только рабочие задачи: у задач по студентам автора в этом списке нет." : null}
      </>}
      actions={<NewTaskButton key={props.composerKey} composer={props.composer} urlIntent={props.urlIntent} showButton={props.canCreate} />}
    >
      {props.sourceMessage ? <TaskMessageCard message={props.sourceMessage} /> : null}
      {canRead && tabs.length > 1 ? <SectionTabs label="Чьи задачи" value={filters.view} tabs={tabs} /> : null}
      {canRead ? (
        <TasksTable
          bands={view.bands}
          open={filters.state === "open"}
          listParams={view.listParams}
          showAssignee={filters.view !== "mine"}
          nowIso={props.nowIso}
          permissions={props.permissions}
          leads={props.taskLeads}
          dial={props.dial}
          filterBar={taskFilterBar(filters, props)}
          empty={view.empty}
          sheet={props.sheet}
          closeHref={props.closeHref}
          moveOpen={props.moveOpen}
        />
      ) : (
        <WidgetCard>
          <div role="status">
            <EmptyState title="В вашей роли нет права на просмотр задач." description={props.canCreate ? "Новую задачу можно создать кнопкой выше." : undefined} />
          </div>
        </WidgetCard>
      )}
      {/* Пустое неполное чтение уже сказало это в пустом состоянии. */}
      {canRead && !queue.complete && queue.rows.length > 0 ? (
        <p role="status" className="flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2">
          Показаны не все задачи, числа скрыты.
          {view.readNext ? <Button variant="link" asChild><Link href={view.readNext.href} scroll={false}>{view.readNext.label}</Link></Button> : null}
        </p>
      ) : null}
    </PageShell>
  );
}
