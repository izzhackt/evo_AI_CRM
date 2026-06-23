import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listTasks, listStaff, listClients } from "@/lib/queries";
import { TASK_COLUMNS, TASK_PRIORITIES } from "@/lib/db";
import { addTaskAction, moveTaskAction } from "@/lib/actions";
import { Badge, Card, EmptyState, StatCard, inputCls, btnCls } from "@/components/ui";

const PRIO_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-500",
  normal: "bg-sky-100 text-sky-700",
  high: "bg-amber-100 text-amber-800",
  urgent: "bg-red-100 text-red-700",
};

const COLUMN_COLORS: Record<string, string> = {
  todo: "border-t-slate-400",
  in_progress: "border-t-sky-400",
  review: "border-t-amber-400",
  done: "border-t-green-500",
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ assignee?: string }>;
}) {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("taskBoard")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("taskBoardHint")}</p>
        </div>
        <form className="flex items-center gap-2">
          <select name="assignee" defaultValue={assignee ?? ""} className={`${inputCls} max-w-52`}>
            <option value="">{t("allAssignees")}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="submit" className={btnCls}>{t("search")}</button>
        </form>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label={t("openTasks")} value={openTasks} />
        <StatCard label={t("urgentTasks")} value={urgentTasks} />
        <StatCard label={t("doneTasks")} value={doneTasks} />
      </div>

      <Card title={`+ ${t("addTask")}`}>
        <form action={addTaskAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input name="title" required placeholder={t("title")} className={`${inputCls} lg:col-span-2`} />
          <select name="priority" defaultValue="normal" className={inputCls}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{t(`prio.${p}`)}</option>)}
          </select>
          <input name="description" placeholder={t("notes")} className={`${inputCls} lg:col-span-3`} />
          <select name="assignee_id" className={inputCls}>
            <option value="">{t("assignee")}: {t("notAssigned")}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="client_id" className={inputCls}>
            <option value="">{t("client")}: —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="due_date" type="date" className={inputCls} />
          <button type="submit" className={btnCls}>{t("add")}</button>
        </form>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {TASK_COLUMNS.map((col) => {
          const column = tasks.filter((task) => task.status === col);
          return (
            <div key={col} className={`rounded-xl border border-slate-200 border-t-4 bg-white shadow-sm ${COLUMN_COLORS[col]}`}>
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-sm font-semibold text-slate-800">{t(`col.${col}`)}</span>
                <span className="rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-500">{column.length}</span>
              </div>
              <div className="space-y-2 p-2">
                {column.map((task) => (
                  <div key={task.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">{task.title}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIO_COLORS[task.priority] ?? PRIO_COLORS.normal}`}>
                        {t(`prio.${task.priority}`)}
                      </span>
                    </div>
                    {task.description && <div className="mt-1 text-xs text-slate-500">{task.description}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      {task.assignee_name && <span>{t("assignee")}: {task.assignee_name}</span>}
                      {task.due_date && <span>{t("dueDate")}: {task.due_date}</span>}
                      {task.client_id && (
                        <Link href={`/clients/${task.client_id}`} className="text-indigo-600 hover:underline">
                          {task.client_name}
                        </Link>
                      )}
                      {task.stage && <Badge value={task.stage} label={t(`stage.${task.stage}`)} />}
                      {task.target_country && <span>{task.target_country}</span>}
                    </div>
                    <form action={moveTaskAction} className="mt-2 flex gap-1">
                      <input type="hidden" name="id" value={task.id} />
                      <select name="status" defaultValue={task.status} className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs">
                        {TASK_COLUMNS.map((s) => <option key={s} value={s}>{t(`col.${s}`)}</option>)}
                      </select>
                      <button type="submit" className="rounded border border-slate-300 bg-white px-2 text-xs hover:bg-slate-100">→</button>
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
