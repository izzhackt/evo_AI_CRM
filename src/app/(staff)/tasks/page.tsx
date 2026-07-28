import Link from "next/link";

import { Icon } from "@/components/icons";
import { ContextBanner } from "@/components/platform/operations/OperationsPrimitives";
import {
  EmptyState,
  PageHeader,
  StatCard,
  btnCls,
  btnGhostCls,
  cn,
  inputCls,
} from "@/components/ui";
import { addTaskAction, moveTaskAction } from "@/lib/actions";
import { TASK_COLUMNS, TASK_PRIORITIES } from "@/lib/db";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import {
  listClientsForActor,
  listLeads,
  listStaff,
  listTasksForActor,
} from "@/lib/queries";

const PRIO_CLS: Record<string, string> = {
  low: "bg-surface-2 text-fg-3",
  normal: "bg-info-weak text-info",
  high: "bg-warn-weak text-warn",
  urgent: "bg-danger-weak text-danger",
};

const COLUMN_CHIP: Record<string, string> = {
  todo: "bg-info",
  in_progress: "bg-accent",
  review: "bg-warn",
  done: "bg-ok",
};

type TaskRow = ReturnType<typeof listTasksForActor>[number];
type TaskView = "board" | "list" | "calendar";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function monthKey(value?: string) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
    ? value
    : new Date().toISOString().slice(0, 7);
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function taskHref(
  view: TaskView,
  assignee: string | undefined,
  month: string,
) {
  const query = new URLSearchParams({ view });
  if (assignee) query.set("assignee", assignee);
  if (view === "calendar") query.set("month", month);
  return `/tasks?${query.toString()}`;
}

function TaskCard({
  task,
  t,
  compact = false,
  canOpenSales,
}: {
  task: TaskRow;
  t: (key: string) => string;
  compact?: boolean;
  canOpenSales: boolean;
}) {
  const overdue =
    task.status !== "done" &&
    Boolean(task.due_date && task.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10));

  return (
    <article
      id={`task-${task.id}`}
      data-testid={task.priority === "urgent" || overdue ? "urgent-task-card" : "task-card"}
      className={cn(
        "scroll-mt-28 rounded-ctl border bg-surface p-3 shadow-evo",
        overdue ? "border-danger/30" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-[13px] font-semibold text-fg">{task.title}</h3>
        <span
          className={cn(
            "inline-flex min-h-5 shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold",
            PRIO_CLS[task.priority] ?? PRIO_CLS.normal,
          )}
        >
          {t(`prio.${task.priority}`)}
        </span>
      </div>
      {!compact && task.description && (
        <p className="mt-1 break-words text-[12px] leading-5 text-fg-3">{task.description}</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[12px]">
        {task.client_id && (
          <Link href={`/clients/${task.client_id}`} className="font-medium text-accent hover:underline">
            {task.client_name}
          </Link>
        )}
        {task.lead_id && canOpenSales && (
          <Link href={`/sales/${task.lead_id}`} className="font-medium text-accent hover:underline">
            {task.lead_name}
          </Link>
        )}
        {task.lead_id && !canOpenSales && (
          <span className="font-medium text-fg-2">{task.lead_name}</span>
        )}
        {task.due_date && (
          <span className={cn("inline-flex items-center gap-1 font-mono", overdue ? "text-danger" : "text-fg-3")}>
            <Icon name="calendar" size={13} />
            {task.due_date}
            {overdue && <span className="font-sans font-semibold">· {t("overdue")}</span>}
          </span>
        )}
      </div>
      {task.assignee_name && (
        <div className="mt-2 flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-weak text-[10px] font-semibold text-accent">
            {initials(task.assignee_name)}
          </span>
          <span className="truncate text-[12px] text-fg-2">{task.assignee_name}</span>
        </div>
      )}
      {!compact && (
        <form action={moveTaskAction} className="mt-3 flex gap-2">
          <input type="hidden" name="id" value={task.id} />
          <select
            name="status"
            defaultValue={task.status}
            aria-label={t("status")}
            className={cn(inputCls, "h-10 min-w-0 flex-1 text-[12px]")}
          >
            {TASK_COLUMNS.map((status) => (
              <option key={status} value={status}>
                {t(`col.${status}`)}
              </option>
            ))}
          </select>
          <button type="submit" className={cn(btnGhostCls, "h-10 shrink-0")}>
            {t("save")}
          </button>
        </form>
      )}
    </article>
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ assignee?: string; view?: string; month?: string }>;
}) {
  const user = await requireStaffRoute("/tasks");
  const { t, locale } = await getT();
  const params = await searchParams;
  const assigneeId = params.assignee ? Number.parseInt(params.assignee, 10) : undefined;
  const view: TaskView =
    params.view === "list" || params.view === "calendar" ? params.view : "board";
  const selectedMonth = monthKey(params.month);
  const tasks = listTasksForActor(
    user,
    Number.isFinite(assigneeId) ? assigneeId : undefined,
  );
  const staff = listStaff();
  const clients = listClientsForActor(user).filter(
    (client) => client.access_mode !== "sales_post_handoff_summary",
  );
  const canOpenSales = user.role === "admin" || user.role === "sales";
  const canOpenCalls = canOpenSales;
  const meetingLeads = canOpenSales
    ? listLeads().filter((lead) => ["meeting_scheduled", "meeting_done"].includes(lead.status))
    : [];
  const openTasks = tasks.filter((task) => task.status !== "done").length;
  const urgentTasks = tasks.filter(
    (task) =>
      task.status !== "done" && (task.priority === "urgent" || task.priority === "high"),
  ).length;
  const doneTasks = tasks.filter((task) => task.status === "done").length;
  const today = new Date().toISOString().slice(0, 10);
  const overdueTasks = tasks.filter(
    (task) => task.status !== "done" && task.due_date && task.due_date < today,
  ).length;

  const [year, month] = selectedMonth.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadingEmpty = (firstDay.getUTCDay() + 6) % 7;
  const monthLabel = new Intl.DateTimeFormat(
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU",
    { month: "long", year: "numeric", timeZone: "UTC" },
  ).format(firstDay);
  const datedTasks = tasks
    .filter((task) => task.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));

  return (
    <div className="space-y-5" data-testid="tasks-page">
      <PageHeader
        title={t("taskBoard")}
        description={t("taskBoardHint")}
        action={
          <Link href="#add" className={btnCls}>
            <Icon name="plus" size={16} />
            {t("addTask")}
          </Link>
        }
      />

      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3 shadow-evo lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label={t("taskBoard")} className="grid grid-cols-3 gap-1 rounded-ctl bg-surface-2 p-1">
          {([
            ["board", t("board"), "grid"],
            ["list", t("taskList"), "check-square"],
            ["calendar", t("taskCalendar"), "calendar"],
          ] as const).map(([value, label, icon]) => (
            <Link
              key={value}
              href={taskHref(value, params.assignee, selectedMonth)}
              aria-current={view === value ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-nav px-3 text-[12px] font-semibold",
                view === value ? "bg-surface text-accent shadow-evo" : "text-fg-3 hover:text-fg",
              )}
            >
              <Icon name={icon} size={15} />
              {label}
            </Link>
          ))}
        </nav>
        <form className="flex min-w-0 items-center gap-2">
          <input type="hidden" name="view" value={view} />
          {view === "calendar" && <input type="hidden" name="month" value={selectedMonth} />}
          <select
            name="assignee"
            defaultValue={params.assignee ?? ""}
            aria-label={t("assignee")}
            className={cn(inputCls, "h-10 min-w-0 flex-1 lg:w-56")}
          >
            <option value="">{t("allAssignees")}</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <button type="submit" className={cn(btnGhostCls, "h-10")}>
            {t("search")}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("openTasks")} value={openTasks} tone="accent" />
        <StatCard label={t("urgentTasks")} value={urgentTasks} tone="danger" />
        <StatCard label={t("overdueTasks")} value={overdueTasks} tone="warning" />
        <StatCard label={t("doneTasks")} value={doneTasks} tone="success" />
      </div>

      <details id="add" className="scroll-mt-24 rounded-card border border-border bg-surface shadow-evo">
        <summary className="cursor-pointer list-none px-5 py-4 text-[14px] font-bold text-fg">
          <span className="inline-flex items-center gap-2">
            <Icon name="plus" size={16} />
            {t("addTask")}
          </span>
        </summary>
        <form action={addTaskAction} className="grid gap-2 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
          <input name="title" required placeholder={t("title")} className={cn(inputCls, "lg:col-span-2")} />
          <select name="priority" defaultValue="normal" className={inputCls}>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`prio.${priority}`)}
              </option>
            ))}
          </select>
          <input name="description" placeholder={t("notes")} className={cn(inputCls, "lg:col-span-3")} />
          <select name="assignee_id" className={inputCls}>
            <option value="">
              {t("assignee")}: {t("notAssigned")}
            </option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <select name="client_id" className={inputCls}>
            <option value="">{t("client")}: —</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <input name="due_date" type="date" className={cn(inputCls, "font-mono")} />
          <button type="submit" className={btnCls}>
            {t("add")}
          </button>
        </form>
      </details>

      {view === "board" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TASK_COLUMNS.map((columnName) => {
            const column = tasks.filter((task) => task.status === columnName);
            return (
              <section key={columnName} className="rounded-card border border-border bg-surface shadow-evo">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", COLUMN_CHIP[columnName])} />
                    <span className="truncate text-[13.5px] font-semibold text-fg">
                      {t(`col.${columnName}`)}
                    </span>
                  </span>
                  <span className="rounded-full bg-surface-2 px-2 font-mono text-[12px] font-semibold text-fg-2">
                    {column.length}
                  </span>
                </div>
                <div className="space-y-2.5 p-2.5">
                  {column.map((task) => (
                    <TaskCard key={task.id} task={task} t={t} canOpenSales={canOpenSales} />
                  ))}
                  {column.length === 0 && <EmptyState text={t("noTasksInColumn")} />}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === "list" && (
        <section aria-label={t("taskList")} className="grid gap-3 lg:grid-cols-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} t={t} canOpenSales={canOpenSales} />
          ))}
          {tasks.length === 0 && (
            <div className="rounded-card border border-border bg-surface lg:col-span-2">
              <EmptyState text={t("noResults")} />
            </div>
          )}
        </section>
      )}

      {view === "calendar" && (
        <div className="space-y-4">
          <ContextBanner
            title={t("taskCalendar")}
            description={t("taskCalendarHint")}
            tone="info"
          />
          <section className="overflow-hidden rounded-card border border-border bg-surface shadow-evo">
            <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5">
              <Link
                href={taskHref("calendar", params.assignee, shiftMonth(selectedMonth, -1))}
                aria-label={t("previousMonth")}
                className={cn(btnGhostCls, "h-10 px-3")}
              >
                <Icon name="arrow-left" size={15} />
              </Link>
              <h2 className="text-center text-[15px] font-bold capitalize text-fg">{monthLabel}</h2>
              <Link
                href={taskHref("calendar", params.assignee, shiftMonth(selectedMonth, 1))}
                aria-label={t("nextMonth")}
                className={cn(btnGhostCls, "h-10 px-3")}
              >
                <Icon name="chevron-right" size={15} />
              </Link>
            </header>
            <div className="grid grid-cols-7 border-b border-border bg-surface-2">
              {["weekMon", "weekTue", "weekWed", "weekThu", "weekFri", "weekSat", "weekSun"].map((day) => (
                <div key={day} className="px-1 py-2 text-center text-[10px] font-bold uppercase text-fg-3 sm:text-[11px]">
                  {t(day)}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7" data-testid="task-calendar">
              {Array.from({ length: leadingEmpty }, (_, index) => (
                <div key={`empty-${index}`} className="min-h-20 border-b border-r border-border bg-surface-2/40 sm:min-h-28" />
              ))}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const day = index + 1;
                const date = `${selectedMonth}-${String(day).padStart(2, "0")}`;
                const dayTasks = tasks.filter((task) => task.due_date?.slice(0, 10) === date);
                return (
                  <div
                    key={date}
                    className={cn(
                      "min-h-20 min-w-0 border-b border-r border-border p-1 sm:min-h-28 sm:p-2",
                      date === today && "bg-accent-weak/60",
                    )}
                  >
                    <div className={cn("mb-1 font-mono text-[10px] text-fg-3 sm:text-[11px]", date === today && "font-bold text-accent")}>
                      {day}
                    </div>
                    <div className="space-y-1">
                      {dayTasks.slice(0, 2).map((task) => (
                        <a
                          key={task.id}
                          href={`#agenda-task-${task.id}`}
                          title={task.title}
                          className={cn(
                            "block truncate rounded px-1 py-1 text-[9px] font-semibold sm:text-[10px]",
                            task.priority === "urgent"
                              ? "bg-danger-weak text-danger"
                              : "bg-info-weak text-info",
                          )}
                        >
                          {task.title}
                        </a>
                      ))}
                      {dayTasks.length > 2 && (
                        <span className="block text-[9px] font-semibold text-fg-3">+{dayTasks.length - 2}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="task-agenda-title">
            <h2 id="task-agenda-title" className="mb-3 text-[15px] font-bold text-fg">
              {t("taskAgenda")}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {datedTasks.map((task) => (
                <div key={task.id} id={`agenda-task-${task.id}`} className="scroll-mt-28">
                  <TaskCard task={task} t={t} canOpenSales={canOpenSales} />
                </div>
              ))}
              {datedTasks.length === 0 && (
                <div className="rounded-card border border-border bg-surface lg:col-span-2">
                  <EmptyState text={t("noCalendarTasks")} />
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <section className="rounded-card border border-border bg-surface p-4 shadow-evo">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-fg">{t("taskMeetingJourney")}</h2>
            <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-fg-3">
              {t("taskMeetingJourneyHint")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="#add" className={btnGhostCls}>
              <Icon name="calendar" size={15} />
              {t("planNextContact")}
            </Link>
            {canOpenCalls && (
              <Link href="/calls" className={btnGhostCls}>
                <Icon name="phone" size={15} />
                {t("callJournal")}
              </Link>
            )}
          </div>
        </div>
        {canOpenSales && meetingLeads.length > 0 ? (
          <ul role="list" className="mt-4 grid gap-2 md:grid-cols-2">
            {meetingLeads.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/sales/${lead.id}`}
                  className="flex min-h-16 items-center justify-between gap-3 rounded-ctl border border-border px-3 py-2 hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-[13px] text-fg">{lead.name}</strong>
                    <small className="text-[11px] text-fg-3">{t(`lead.${lead.status}`)}</small>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-fg-3">
                    {lead.next_task_due_date ?? "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-[12px] text-fg-3">{t("noScheduledMeetings")}</p>
        )}
      </section>
    </div>
  );
}
