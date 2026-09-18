import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import Link from "next/link";

import { Card } from "@/components/ui";
import { dayFullLabel, timeLabel } from "@/components/v3/calendar/types";
import { getPlatformAdmissionsTaskWorkspace } from "@/lib/platform-admissions-workspace";
import { projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import { taskStatus } from "@/lib/v3/wording";

function Deadline({ dueOn, dueAt, status, now }: Readonly<{
  dueOn: string | null; dueAt: string | null; status: string; now: Date;
}>) {
  const deadline = projectPlatformTaskDeadline(dueOn, dueAt, now);
  const overdue = deadline.overdue && status !== "done" && status !== "cancelled";
  return (
    <span className={overdue ? "text-danger" : "text-fg-2"}>
      {deadline.day
        ? `${dayFullLabel(deadline.day)}${deadline.minutes === null ? " · весь день" : ` · ${timeLabel(deadline.minutes)}`}`
        : "Без срока"}
      {overdue ? " · Просрочено" : ""}
    </span>
  );
}

/**
 * Задачи дела — обзор ведущего списка, не редактор.
 *
 * Источник тот же, что у карточки дела на «Задачи»/«Календарь»:
 * `getPlatformAdmissionsTaskWorkspace` по этому делу. Собственный `try/catch`,
 * чтобы недоступное чтение не гасило остальной Обзор.
 */
export async function CaseTasksPanel({
  actor,
  caseId,
}: Readonly<{ actor: ActivePlatformActor; caseId: string }>) {
  if (!staffPresentationCan(actor, "admissions.read")) return null;
  const workspace = await getPlatformAdmissionsTaskWorkspace(actor, caseId).catch(() => null);
  const canCreate = !isStaffPreview(actor) && staffHasPermission(actor, "task.manage");
  const createLink = canCreate ? (
    <Link
      href={`/v3/tasks?create=case&case=${encodeURIComponent(caseId)}`}
      className="inline-flex min-h-11 items-center text-xs font-semibold text-accent hover:underline"
    >
      Создать задачу
    </Link>
  ) : undefined;

  if (!workspace) {
    return (
      <Card eyebrow title="Задачи по делу" aside={createLink}>
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          Не удалось загрузить задачи. Обновите страницу, чтобы повторить.
        </p>
      </Card>
    );
  }

  const now = new Date();
  const open = workspace.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");

  return (
    <Card eyebrow title="Задачи по делу" aside={createLink}>
      {open.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-3">Открытых задач нет.</p>
      ) : (
        <ul className="divide-y divide-border">
          {open.map((task) => (
            <li key={task.caseTaskId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="min-w-0 flex-1 text-sm text-fg">{task.title}</span>
              <span className="shrink-0 text-xs font-medium text-fg-2">{taskStatus(task.status) ?? task.status}</span>
              <Deadline dueOn={task.dueOn} dueAt={task.dueAt} status={task.status} now={now} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
