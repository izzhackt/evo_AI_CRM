import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listTasks, listStaff, listClients } from "@/lib/queries";
import { TASK_COLUMNS, TASK_PRIORITIES } from "@/lib/db";
import { addTaskAction, moveTaskAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { Card, EmptyState, StatCard, inputCls, btnCls, btnGhostCls, cn } from "@/components/ui";

const PRIO_CLS: Record<string, string> = {
  low: "bg-surface-2 text-fg-3",
  normal: "bg-info-weak text-info",
  high: "bg-warn-weak text-warn",
  urgent: "bg-danger-weak text-danger",
  done: "bg-surface-2 text-fg-3",
};

const COLUMN_CHIP: Record<string, string> = {
  todo: "bg-info",
  in_progress: "bg-accent",
  review: "bg-warn",
  done: "bg-ok",
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ assignee?: string }>;
}) {
  await requireStaffRoute("/tasks");
  const { t } = await getT();
  const { assignee } = await searchParams;
  const assigneeId = assignee ? parseInt(assignee, 10) : undefined;
  const tasks = listTasks(assigneeId);
  const staff = listStaff();
  const clients = listClients();
  const openTasks = tasks.filter((task) => task.status !== "done").length;
  const urgentTasks = tasks.filter((task) => task.status !== "done" && (task.priority === "urgent" || task.priority === "high")).length;
  const doneTasks = tasks.filter((task) => task.status === "done").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form className="flex items-center gap-2">
          <select name="assignee" defaultValue={assignee ?? ""} className={cn(inputCls, "h-10 max-w-52")}>
            <option value="">{t("allAssignees")}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="submit" className={btnGhostCls}>{t("search")}</button>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("openTasks")} value={openTasks} tone="accent" />
        <StatCard label={t("urgentTasks")} value={urgentTasks} tone="danger" />
        <StatCard label={t("doneTasks")} value={doneTasks} tone="success" />
      </div>

      <Card title={t("addTask")}>
        <form id="add" action={addTaskAction} className="grid scroll-mt-24 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input name="title" required placeholder={t("title")} className={cn(inputCls, "lg:col-span-2")} />
          <select name="priority" defaultValue="normal" className={inputCls}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{t(`prio.${p}`)}</option>)}
          </select>
          <input name="description" placeholder={t("notes")} className={cn(inputCls, "lg:col-span-3")} />
          <select name="assignee_id" className={inputCls}>
            <option value="">{t("assignee")}: {t("notAssigned")}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="client_id" className={inputCls}>
            <option value="">{t("client")}: —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="due_date" type="date" className={cn(inputCls, "font-mono")} />
          <button type="submit" className={btnCls}>{t("add")}</button>
        </form>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TASK_COLUMNS.map((col) => {
          const column = tasks.filter((task) => task.status === col);
          return (
            <div key={col} className="rounded-card border border-border bg-surface shadow-evo">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", COLUMN_CHIP[col])} />
                  <span className="truncate text-[13.5px] font-semibold text-fg">{t(`col.${col}`)}</span>
                </span>
                <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-surface-2 px-1.5 font-mono text-[12px] font-semibold text-fg-2">{column.length}</span>
              </div>
              <div className="space-y-2.5 p-2.5">
                {column.map((task) => (
                  <div key={task.id} className="rounded-ctl border border-border bg-surface p-3 transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-evo-lg">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-semibold text-fg">{task.title}</span>
                      <span className={cn("inline-flex min-h-5 shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold", PRIO_CLS[task.priority] ?? PRIO_CLS.normal)}>
                        {t(`prio.${task.priority}`)}
                      </span>
                    </div>
                    {task.description && <div className="mt-1 text-[12px] text-fg-3">{task.description}</div>}

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[12px]">
                      {task.client_id && (
                        <Link href={`/clients/${task.client_id}`} className="font-medium text-accent hover:underline">{task.client_name}</Link>
                      )}
                      {task.lead_id && (
                        <Link href={`/sales/${task.lead_id}`} className="font-medium text-accent hover:underline">{task.lead_name}</Link>
                      )}
                      {task.due_date && <span className="font-mono text-fg-3">{task.due_date}</span>}
                    </div>

                    {task.assignee_name && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-weak text-[10px] font-semibold text-accent">
                          {initials(task.assignee_name)}
                        </span>
                        <span className="truncate text-[12px] text-fg-2">{task.assignee_name}</span>
                      </div>
                    )}

                    <form action={moveTaskAction} className="mt-3 flex gap-2">
                      <input type="hidden" name="id" value={task.id} />
                      <select name="status" defaultValue={task.status} className={cn(inputCls, "h-9 text-[12px]")}>
                        {TASK_COLUMNS.map((s) => <option key={s} value={s}>{t(`col.${s}`)}</option>)}
                      </select>
                      <button type="submit" className={btnGhostCls}>{t("save")}</button>
                    </form>
                  </div>
                ))}
                {column.length === 0 && <EmptyState text={t("noTasksInColumn")} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
