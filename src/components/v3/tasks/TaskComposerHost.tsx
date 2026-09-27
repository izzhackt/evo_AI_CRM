"use client";

import { useEffect, useRef, useState } from "react";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";

import { TaskComposerDialog } from "./TaskComposerDialog";
import { registerTaskComposerOpener, useTaskComposerPageContext, type TaskComposerPageContext } from "./task-composer-context";

/** Кто может создать задачу из оболочки: те же условия, что у страницы «Задач». */
export function taskComposerAccess(actor: ActivePlatformActor) {
  const preview = isStaffPreview(actor);
  return {
    staff: !preview && staffHasPermission(actor, "staff.task.create"),
    case: !preview && staffPresentationCan(actor, "admissions.read") && staffHasPermission(actor, "task.create"),
  };
}

type Request = Readonly<{ key: string; context: TaskComposerPageContext }>;

/**
 * Диалог «Новая задача» оболочки (Э7): «Создать задачу» меню и Ctrl+K
 * открывают его на месте, без перехода на «Задачи», с контекстом страницы
 * (`TaskComposerContextMark`). Это тот же `TaskComposerDialog`, что у
 * остальных входов. После закрытия фокус возвращается туда, откуда диалог
 * открыли.
 */
export function TaskComposerHost({ actor }: Readonly<{ actor: ActivePlatformActor }>) {
  const page = useTaskComposerPageContext();
  const [request, setRequest] = useState<Request | null>(null);
  const pageRef = useRef(page);
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => registerTaskComposerOpener((context, returnFocus) => {
    const active = document.activeElement;
    returnTo.current = returnFocus ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    setRequest({ key: crypto.randomUUID(), context: { ...pageRef.current, ...context } });
  }), []);

  const access = taskComposerAccess(actor);
  if (!request || (!access.staff && !access.case)) return null;
  const { context } = request;
  // Лид — только для рабочей задачи; дело — только тому, кто создаёт задачи по студентам.
  const lead = access.staff && !context.case ? context.lead ?? null : null;
  return (
    <TaskComposerDialog
      key={request.key}
      hideTrigger
      openIntent={request.key}
      participants={null}
      actor={actor}
      actorMembershipId={actor.membershipId}
      day={dayInOrganizationTimezone(new Date())}
      defaultDueDay={context.dueDay ?? null}
      staffAllowed={access.staff}
      caseAllowed={access.case}
      initialCase={access.case ? context.case ?? null : null}
      initialCaseAssignees={context.caseAssignees ?? []}
      initialCases={access.case ? context.cases ?? [] : []}
      casesHaveMore={access.case ? context.casesHaveMore ?? false : false}
      caseRemovable={!context.caseFixed}
      sourceLeadId={lead?.id}
      sourceLeadVersion={lead?.version}
      sourceLeadName={lead?.name ?? null}
      onClosed={() => {
        setRequest(null);
        const target = returnTo.current;
        if (target?.isConnected && target.getClientRects().length > 0) target.focus();
      }}
    />
  );
}
