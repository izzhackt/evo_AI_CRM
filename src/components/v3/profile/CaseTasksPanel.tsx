import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import Link from "next/link";

import { Card } from "@/components/ui";
import { dayFullLabel, timeLabel } from "@/components/v3/calendar/types";
import { getPlatformAdmissionsTaskWorkspace } from "@/lib/platform-admissions-workspace";
import { dayInOrganizationTimezone, projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import { taskStatus } from "@/lib/v3/wording";
import { TaskComposerDialog } from "@/components/v3/tasks/TaskComposerDialog";

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
  caseName,
}: Readonly<{ actor: ActivePlatformActor; caseId: string; caseName: string }>) {
  if (!staffPresentationCan(actor, "admissions.read")) return null;
  const workspace = await getPlatformAdmissionsTaskWorkspace(actor, caseId).catch(() => null);
  // The unified composer writes through platform.create_case_task, gated on
  // task.create (src/lib/platform-admissions-task-actions.ts); task.manage
  // alone (the old link's gate) is not sufficient to actually save.
  const canCreate = !isStaffPreview(actor) && staffHasPermission(actor, "task.create");
  const day = dayInOrganizationTimezone(new Date());
  const trigger = canCreate ? (
    <TaskComposerDialog
      participants={[]} actorMembershipId={actor.membershipId} actor={actor} day={day}
      staffAllowed={false} caseAllowed
      initialCase={{ id: caseId, name: caseName }}
      initialCaseAssignees={workspace?.assignees.map(({ membershipId, displayName }) => ({ membershipId, displayName })) ?? []}
      triggerLabel="+ Задача"
      triggerClassName="inline-flex min-h-11 items-center text-xs font-semibold text-accent hover:underline"
    />
  ) : undefined;

  if (!workspace) {
    return (
      <Card eyebrow title="Задачи по делу" aside={trigger} id="case-tasks">
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          Не удалось загрузить задачи. Обновите страницу, чтобы повторить.
        </p>
      </Card>
    );
  }

  const now = new Date();
  const open = workspace.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");

  return (
    <Card eyebrow title="Задачи по делу" aside={trigger} id="case-tasks">
      {open.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-3">Открытых задач нет.</p>
      ) : (
        <ul className="divide-y divide-border">
          {open.map((task) => (
            <li key={task.caseTaskId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
              <Link href={`/v3/tasks?task=${task.caseTaskId}&kind=case&case=${caseId}`} className="min-w-0 flex-1 text-sm text-fg underline decoration-transparent hover:decoration-inherit">
                {task.title}
              </Link>
              <span className="shrink-0 text-xs font-medium text-fg-2">{taskStatus(task.status) ?? task.status}</span>
              <Deadline dueOn={task.dueOn} dueAt={task.dueAt} status={task.status} now={now} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
