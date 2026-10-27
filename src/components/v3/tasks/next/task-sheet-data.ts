/**
 * Что нужно панели задачи «Нового вида». Та же форма данных, что у `TaskDetailPanel` прежнего вида: страница читает
 * их теми же чтениями (`readStaffTaskWorkspace`, `readStaffTaskContext`, `readCalendarTaskTarget`) и под теми же
 * правами; здесь они только собираются в одну запись, которую панель показывает. Файл чистый (без React и сервера).
 */
import type { StaffParticipant, StaffTask } from "../../../../lib/platform-staff-task-contract.ts";
import type { CalendarCaseTask, CalendarTaskCapabilities, Day } from "../../calendar/types.ts";

export type TaskSheetOutcome = Readonly<{ requestId: string; note: string; author: string; createdAt: string }>;

export type TaskSheetStaffExtra = Readonly<{
  leadHref: string | null;
  /** Клиент задачи, когда набор открыт сотруднику (телефония): имя, «Позвонить» и карточка лида; иначе null. */
  lead: Readonly<{ leadId: string; name: string; href: string; mapped: boolean }> | null;
  sourceHref: string | null;
  sourceUnavailable: boolean;
  outcomes: readonly TaskSheetOutcome[];
  outcomesUnavailable: boolean;
}>;

type Common = Readonly<{ key: string; day: Day; nowIso: string }>;

export type TaskSheetData =
  | (Common & Readonly<{ kind: "staff"; task: StaffTask; participants: readonly StaffParticipant[]; extra: TaskSheetStaffExtra }>)
  | (Common & Readonly<{
      kind: "case"; task: CalendarCaseTask; caseId: string;
      assignees: readonly Readonly<{ membershipId: string; displayName: string }>[];
      capabilities: CalendarTaskCapabilities;
    }>);

const NO_EXTRA: TaskSheetStaffExtra = Object.freeze({
  leadHref: null, lead: null, sourceHref: null, sourceUnavailable: false, outcomes: [], outcomesUnavailable: false,
});

/** Панель выбранной рабочей задачи; ключ — как у прежней панели (`staff:<id>`), чтобы введённое не переезжало в другую задачу. */
export function staffSheetData(input: Readonly<{
  task: StaffTask; participants: readonly StaffParticipant[]; day: Day; nowIso: string;
  leadId: string | null; lead: TaskSheetStaffExtra["lead"]; sourceHref: string | null; sourceUnavailable: boolean;
  outcomes: readonly TaskSheetOutcome[] | null;
}>): TaskSheetData {
  return {
    key: `staff:${input.task.id}`, kind: "staff", task: input.task, participants: input.participants, day: input.day, nowIso: input.nowIso,
    extra: {
      ...NO_EXTRA,
      leadHref: input.leadId ? `/v3/tasks?lead=${input.leadId}` : null,
      lead: input.lead,
      sourceHref: input.sourceHref,
      sourceUnavailable: Boolean(input.task.sourceMessageId) && !input.sourceHref && input.sourceUnavailable,
      outcomes: input.outcomes ?? [],
      outcomesUnavailable: input.outcomes === null,
    },
  };
}

export function caseSheetData(input: Readonly<{
  task: CalendarCaseTask; caseId: string; assignees: TaskSheetDataCase["assignees"]; capabilities: CalendarTaskCapabilities; day: Day; nowIso: string;
}>): TaskSheetData {
  return { key: `case:${input.task.id}`, kind: "case", task: input.task, caseId: input.caseId, assignees: input.assignees, capabilities: input.capabilities, day: input.day, nowIso: input.nowIso };
}

type TaskSheetDataCase = Extract<TaskSheetData, { kind: "case" }>;
