"use client";

import { useRef, useState } from "react";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { staffHasPermission } from "@/lib/platform-access";
import type { StaffParticipant } from "@/lib/platform-staff-task-contract";
import { CalendarCreateTaskForm } from "../calendar/TaskControls";
import type { CalendarCaseOption } from "../calendar/types";
import { StaffTaskForm } from "./StaffTaskForm";

export function TaskComposer({ participants, caseAssignees, actorMembershipId, actor, canCreateCase, selectedCase, day, requestId, caseRequestId, initiallyOpen = false, initialKind = "staff", initialTitle, sourceMessageId, sourceMessageVersion, sourceLeadId, sourceLeadVersion, openIntent = null }: Readonly<{
  participants: readonly StaffParticipant[]; actorMembershipId: string; actor: ActivePlatformActor;
  caseAssignees: readonly Readonly<{ membershipId: string; displayName: string }>[];
  canCreateCase: boolean; selectedCase: CalendarCaseOption | null; day: string; requestId: string; caseRequestId: string;
  initiallyOpen?: boolean; initialKind?: "staff" | "case";
  initialTitle?: string; sourceMessageId?: string; sourceMessageVersion?: string;
  sourceLeadId?: string; sourceLeadVersion?: string;
  openIntent?: string | null;
}>) {
  const caseAllowed = canCreateCase && !sourceMessageId && !sourceLeadId;
  const staffAllowed = staffHasPermission(actor, "staff.task.create");
  const [open, setOpen] = useState(initiallyOpen);
  const [kind, setKind] = useState<"staff" | "case">(caseAllowed ? staffAllowed ? initialKind : "case" : "staff");
  const [seenIntent, setSeenIntent] = useState(openIntent);
  // An explicit navigation can reopen the mounted composer without replacing
  // its form, draft or uncertain-write snapshot. Ordinary refresh is not intent.
  if (seenIntent !== openIntent) {
    setSeenIntent(openIntent);
    if (openIntent !== null) {
      setOpen(true);
      setKind(caseAllowed ? staffAllowed ? initialKind : "case" : "staff");
    }
  }
  const trigger = useRef<HTMLButtonElement>(null);
  return <section className="mb-6" aria-label="Создание задачи" onKeyDown={(event) => {
    if (event.key === "Escape" && open) { setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls="task-composer" onClick={() => setOpen(!open)}
      className="min-h-11 rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent">{open ? "Свернуть форму" : "Создать задачу"}</button>
    {/* Keep drafts mounted when the form or task kind is collapsed. */}
    <div id="task-composer" hidden={!open} className="mt-4 border-y border-border py-5">
      {caseAllowed && staffAllowed ? <fieldset className="mb-4 flex flex-wrap gap-3"><legend className="mb-2 text-sm font-medium">Тип задачи</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" checked={kind === "staff"} onChange={() => setKind("staff")} name="task-composer-kind" />Рабочая задача</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" checked={kind === "case"} onChange={() => setKind("case")} name="task-composer-kind" />По студенту</label>
      </fieldset> : null}
      {staffAllowed ? <div hidden={kind !== "staff"}><StaffTaskForm participants={participants} actorMembershipId={actorMembershipId} day={day} requestId={requestId}
        initialTitle={initialTitle} sourceMessageId={sourceMessageId} sourceMessageVersion={sourceMessageVersion}
        sourceLeadId={sourceLeadId} sourceLeadVersion={sourceLeadVersion} /></div> : null}
      {caseAllowed ? <div hidden={kind !== "case"}><CalendarCreateTaskForm key={caseRequestId} cases={selectedCase ? [selectedCase] : []} casesHaveMore={false}
        assignees={caseAssignees} actorMembershipId={actorMembershipId} actor={actor} day={day} requestId={caseRequestId}
        selectedCase={selectedCase ?? undefined} expanded /></div> : null}
    </div>
  </section>;
}
