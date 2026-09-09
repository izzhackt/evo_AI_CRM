"use client";

import { useRef, useState } from "react";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { StaffParticipant } from "@/lib/platform-staff-task-contract";
import { CalendarCreateTaskForm } from "../calendar/TaskControls";
import type { CalendarCaseOption } from "../calendar/types";
import { StaffTaskForm } from "./StaffTaskForm";

export function TaskComposer({ participants, actorMembershipId, presentationRole, canCreateCase, selectedCase, day, requestId, caseRequestId, initiallyOpen = false, initialKind = "staff", initialTitle, sourceMessageId, sourceMessageVersion }: Readonly<{
  participants: readonly StaffParticipant[]; actorMembershipId: string; presentationRole: FixedRole;
  canCreateCase: boolean; selectedCase: CalendarCaseOption | null; day: string; requestId: string; caseRequestId: string;
  initiallyOpen?: boolean; initialKind?: "staff" | "case";
  initialTitle?: string; sourceMessageId?: string; sourceMessageVersion?: string;
}>) {
  const caseAllowed = canCreateCase && !sourceMessageId;
  const [open, setOpen] = useState(initiallyOpen);
  const [kind, setKind] = useState<"staff" | "case">(caseAllowed ? initialKind : "staff");
  const trigger = useRef<HTMLButtonElement>(null);
  const caseAssignees = participants.filter((person) => person.role !== "sales");
  return <section className="mb-6" aria-label="Создание задачи" onKeyDown={(event) => {
    if (event.key === "Escape" && open) { setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls="task-composer" onClick={() => setOpen(!open)}
      className="min-h-11 rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent">{open ? "Свернуть форму" : "Создать задачу"}</button>
    {/* Keep drafts mounted when the form or task kind is collapsed. */}
    <div id="task-composer" hidden={!open} className="mt-4 border-y border-border py-5">
      {caseAllowed ? <fieldset className="mb-4 flex flex-wrap gap-3"><legend className="mb-2 text-sm font-medium">Тип задачи</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" checked={kind === "staff"} onChange={() => setKind("staff")} name="task-composer-kind" />Рабочая задача</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" checked={kind === "case"} onChange={() => setKind("case")} name="task-composer-kind" />По студенту</label>
      </fieldset> : null}
      <div hidden={kind !== "staff"}><StaffTaskForm participants={participants} actorMembershipId={actorMembershipId} day={day} requestId={requestId}
        initialTitle={initialTitle} sourceMessageId={sourceMessageId} sourceMessageVersion={sourceMessageVersion} /></div>
      {caseAllowed ? <div hidden={kind !== "case"}><CalendarCreateTaskForm cases={selectedCase ? [selectedCase] : []} casesHaveMore={false}
        assignees={caseAssignees} actorMembershipId={actorMembershipId} presentationRole={presentationRole} day={day} requestId={caseRequestId}
        selectedCase={selectedCase ?? undefined} expanded /></div> : null}
    </div>
  </section>;
}
