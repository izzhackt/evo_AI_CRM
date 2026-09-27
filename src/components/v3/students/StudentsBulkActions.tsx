"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveCaseNextActionAction } from "@/lib/platform-case-next-action-actions";
import { assignCaseCuratorAction } from "@/lib/platform-case-curator-assignment-actions";
import type { StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { BulkActionDialog, BulkBar, BulkDueField, bulkDueDay, useBulkRequestIds, type BulkDueChoice, type BulkSelection } from "../queue/Bulk";
import { QUEUE_FIELD } from "../queue/queue-buttons";
import { nextStepForm } from "./next-step-input";
import type { CuratorName } from "./StudentsQueueHead";
import { nextStepAccess, type NextStepAccessInput } from "./students-queue-view";

export const CASE_NOUN = { one: "дело", few: "дела", many: "дел" } as const;

/** Слова ответа `assignCaseCuratorAction` — те же, что у формы в деле студента. */
export const CURATOR_ERROR_COPY: Readonly<Record<string, string>> = {
  invalid: "Выберите куратора и укажите причину.",
  forbidden: "Нет права назначать куратора этому делу.",
  stale: "Дело уже назначено другому куратору или изменилось.",
  request_conflict: "Этот запрос уже использован. Повторите действие.",
  unavailable: "Не удалось подтвердить сохранение.",
};

/** Слова ответа `saveCaseNextActionAction` — те же, что у редактора шага. */
export const STEP_ERROR_COPY: Readonly<Record<string, string>> = {
  invalid: "Проверьте шаг и срок.",
  forbidden: "Нет права менять следующий шаг этого дела.",
  preview: "В просмотре интерфейса роли изменения не сохраняются.",
  stale: "Шаг уже изменили. Обновите.",
  not_active: "Дело не в работе.",
  request_conflict: "Этот запрос уже использован с другими данными.",
  unavailable: "Не удалось подтвердить сохранение.",
};

export type StudentsBulkAccess = Readonly<{
  /** Назначать кураторов (`case.curator.assign`, не просмотр роли): список кураторов; null — нельзя. */
  curators: readonly CuratorName[] | null;
  /** Права редактора шага — те же, что у «Быстрого просмотра». */
  editor: NextStepAccessInput;
  recordScopes: readonly string[];
}>;

type CaseItem = Readonly<{ key: string; label: string; row: StudentCaseQueueRow }>;

/** Дело ждёт куратора — к нему подходит «Назначить куратора» (`assign_case_curator_v1`). */
export function curatorAssignable(access: StudentsBulkAccess, row: StudentCaseQueueRow): boolean {
  return access.curators !== null && row.attentionFlags.includes("needs_curator");
}

/** Шаг дела можно править, и он есть: срок без шага не сохраняется. */
export function stepDueEditable(access: StudentsBulkAccess, row: StudentCaseQueueRow): boolean {
  return nextStepAccess(access.editor, row, access.recordScopes).kind === "edit" && Boolean(row.nextAction);
}

function stepSkipReason(access: StudentsBulkAccess, row: StudentCaseQueueRow): string {
  if (nextStepAccess(access.editor, row, access.recordScopes).kind !== "edit") return "шаг этого дела вам не изменить";
  return "шаг не задан: срок без шага не сохраняется";
}

/**
 * Одно дело — существующая команда назначения куратора (Э7): своя проверка
 * прав на сервере и свой ключ запроса. null — сохранено.
 */
export async function assignCuratorToCase(row: StudentCaseQueueRow, curatorMembershipId: string, reason: string, requestId: string) {
  const form = new FormData();
  form.set("student_case_id", row.studentCaseId);
  form.set("curator_membership_id", curatorMembershipId);
  form.set("reason", reason.trim());
  form.set("request_id", requestId);
  const state = await assignCaseCuratorAction({ status: "idle", requestId }, form);
  return state.status === "saved"
    ? { error: null, unconfirmed: false }
    : { error: CURATOR_ERROR_COPY[state.status] ?? "Не удалось сохранить.", unconfirmed: state.status === "unavailable" };
}

/**
 * Одно дело — существующая команда шага `set_case_next_action_v1` (Э7):
 * текст шага прежний, срок новый, ожидаемая версия — версия строки из чтения.
 */
export async function moveStepDue(row: StudentCaseQueueRow, dueOn: string, requestId: string) {
  const state = await saveCaseNextActionAction(
    { status: "idle", requestId, message: null, receipt: null },
    nextStepForm(row, row.nextAction ?? "", dueOn, requestId),
  );
  return state.status === "saved"
    ? { error: null, unconfirmed: false }
    : { error: STEP_ERROR_COPY[state.status] ?? "Не удалось сохранить.", unconfirmed: state.status === "unavailable" };
}

/**
 * Строка действий над выбранными делами «Студентов» (Э7): «Назначить
 * куратора» и «Изменить срок шага». Каждое дело — своей командой по одной;
 * дела, к которым действие не подходит, названы до отправки.
 */
export function StudentsBulkActions({
  selection,
  rows,
  allKeys,
  today,
  access,
}: Readonly<{
  selection: BulkSelection;
  rows: ReadonlyMap<string, StudentCaseQueueRow>;
  allKeys: readonly string[];
  today: string;
  access: StudentsBulkAccess;
}>) {
  const router = useRouter();
  const curatorIds = useBulkRequestIds();
  const stepIds = useBulkRequestIds();
  const [openDialogs, setOpenDialogs] = useState(0);
  const [curator, setCurator] = useState("");
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState<BulkDueChoice>("tomorrow");
  const [date, setDate] = useState("");
  const chosen = selection.keys.flatMap((key) => {
    const row = rows.get(key);
    return row ? [{ key, label: row.studentDisplayName, row }] : [];
  });
  const onOpenChange = (open: boolean) => setOpenDialogs((count) => Math.max(0, count + (open ? 1 : -1)));
  const assignItems: CaseItem[] = chosen.filter((item) => curatorAssignable(access, item.row));
  const assignSkipped = chosen.filter((item) => !curatorAssignable(access, item.row))
    .map((item) => ({ key: item.key, label: item.label, reason: "дело не ждёт куратора" }));
  const stepItems: CaseItem[] = chosen.filter((item) => stepDueEditable(access, item.row));
  const stepSkipped = chosen.filter((item) => !stepDueEditable(access, item.row))
    .map((item) => ({ key: item.key, label: item.label, reason: stepSkipReason(access, item.row) }));
  const canStep = allKeys.some((key) => { const row = rows.get(key); return row ? stepDueEditable(access, row) : false; });
  const canAssign = allKeys.some((key) => { const row = rows.get(key); return row ? curatorAssignable(access, row) : false; });

  return (
    <BulkBar selection={selection} allKeys={allKeys} noun={CASE_NOUN} keep={openDialogs > 0}>
      {canAssign && access.curators ? (
        <BulkActionDialog<CaseItem>
          title="Назначить куратора"
          triggerLabel="Назначить куратора"
          testId="students-bulk-curator"
          items={assignItems}
          skipped={assignSkipped}
          noun={CASE_NOUN}
          selection={selection}
          disabled={access.curators.length === 0}
          disabledReason="Некого назначить: список кураторов пуст"
          emptyReason="Нет дел, ждущих куратора"
          onOpenChange={onOpenChange}
          validate={() => !curator ? "Выберите куратора." : !reason.trim() ? "Укажите причину назначения." : reason.trim().length > 1000 ? "Причина — до 1000 символов." : null}
          command={async (item) => {
            const result = await assignCuratorToCase(item.row, curator, reason, curatorIds.idFor(item.key));
            curatorIds.settle(item.key, result.unconfirmed);
            return result.error;
          }}
          onFinished={() => router.refresh()}
        >
          <label className="block t-label text-fg">
            Куратор
            <select value={curator} onChange={(event) => setCurator(event.target.value)} required className={QUEUE_FIELD}>
              <option value="">Выберите куратора</option>
              {access.curators.map((person) => <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
            </select>
          </label>
          <label className="block t-label text-fg">
            Причина назначения
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={2} required
              className="mt-1 block w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 py-2 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent" />
          </label>
        </BulkActionDialog>
      ) : null}
      {canStep ? (
        <BulkActionDialog<CaseItem>
          title="Изменить срок шага"
          triggerLabel="Изменить срок шага"
          testId="students-bulk-step-due"
          items={stepItems}
          skipped={stepSkipped}
          noun={CASE_NOUN}
          selection={selection}
          emptyReason="Нет дел с шагом, доступным вам"
          onOpenChange={onOpenChange}
          validate={() => bulkDueDay(choice, date, today) === "" ? "Выберите дату." : null}
          command={async (item) => {
            const result = await moveStepDue(item.row, bulkDueDay(choice, date, today) ?? "", stepIds.idFor(item.key));
            stepIds.settle(item.key, result.unconfirmed);
            return result.error;
          }}
          onFinished={() => router.refresh()}
        >
          <BulkDueField today={today} choice={choice} date={date} onChoice={setChoice} onDate={setDate} legend="Новый срок шага" />
          <p className="t-meta text-fg-2">Текст шага у каждого дела остаётся прежним.</p>
        </BulkActionDialog>
      ) : null}
    </BulkBar>
  );
}
