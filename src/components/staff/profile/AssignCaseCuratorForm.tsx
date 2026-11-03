"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { btnCls, btnGhostCls, cn, inputCls, fieldLabelCls } from "@/components/ui";
import {
  assignCaseCuratorAction,
  type AssignCaseCuratorActionState,
} from "@/lib/platform-case-curator-assignment-actions";
import type { StudentPortalCuratorOption } from "@/lib/server/student-portal-curator-options";

const MESSAGES: Record<Exclude<AssignCaseCuratorActionState["status"], "idle">, string> = {
  saved: "Куратор назначен.",
  invalid: "Выберите куратора и укажите причину.",
  forbidden: "У вашей роли нет права на это действие.",
  stale: "Дело уже назначено другому куратору или изменилось. Обновите карточку.",
  request_conflict: "Этот запрос уже использован. Повторите действие.",
  unavailable: "Не удалось подтвердить сохранение. Ничего не назначено.",
};

/**
 * S3 (plan §7): «Admin выбирает другого куратора внутри того же дела» for a
 * needs-curator case (a declined assignment reverted to state='pending' with
 * the sale still attached). Only rendered by CaseHeader when both the
 * needs_curator attention flag and case.curator.assign are present — this
 * form does not re-check authority, matching GateActionForm/CuratorCoverageForm.
 */
export function AssignCaseCuratorForm({
  studentCaseId,
  curators,
  requestId,
}: Readonly<{
  studentCaseId: string;
  curators: readonly StudentPortalCuratorOption[];
  requestId: string;
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [curatorMembershipId, setCuratorMembershipId] = useState("");
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState<AssignCaseCuratorActionState, FormData>(
    assignCaseCuratorAction,
    { status: "idle", requestId },
  );
  const saved = state.status === "saved";

  useEffect(() => {
    if (saved) router.refresh();
  }, [router, saved]);

  if (saved) {
    return <p role="status" className="text-sm text-fg-2">{MESSAGES.saved}</p>;
  }

  if (!open) {
    return (
      <button type="button" className={cn(btnGhostCls, "min-h-11 text-xs")} onClick={() => setOpen(true)}>
        Назначить куратора
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2" aria-busy={pending} data-testid="v3-assign-case-curator-form">
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <label className={fieldLabelCls}>
        Куратор
        <select
          name="curator_membership_id"
          required
          disabled={pending}
          value={curatorMembershipId}
          onChange={(event) => setCuratorMembershipId(event.target.value)}
          className={cn(inputCls, "mt-1 min-h-11")}
        >
          <option value="">Выберите куратора</option>
          {curators.map((curator) => (
            <option key={curator.membershipId} value={curator.membershipId}>
              {curator.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldLabelCls}>
        Причина назначения
        <textarea
          name="reason"
          required
          maxLength={1000}
          rows={2}
          disabled={pending}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={cn(inputCls, "mt-1 min-h-16 resize-y")}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || !curatorMembershipId || !reason.trim()} className={cn(btnCls, "min-h-11")}>
          {pending ? "Сохраняем…" : "Назначить"}
        </button>
        <button type="button" disabled={pending} className={cn(btnGhostCls, "min-h-11")} onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
      {state.status !== "idle" ? (
        <p role="alert" className="text-sm text-fg-2">
          {MESSAGES[state.status]}
        </p>
      ) : null}
      {state.status === "stale" || state.status === "request_conflict" ? (
        <button type="button" className={cn(btnGhostCls, "min-h-11 self-start")} onClick={() => router.refresh()}>
          Обновить карточку
        </button>
      ) : null}
    </form>
  );
}
