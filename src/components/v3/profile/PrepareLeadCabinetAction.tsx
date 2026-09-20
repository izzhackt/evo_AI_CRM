"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { btnCls, btnGhostCls, cn } from "@/components/ui";
import {
  prepareLeadCabinetAction,
  type PrepareLeadCabinetActionState,
} from "@/lib/platform-sales-actions";

const MESSAGES: Record<Exclude<PrepareLeadCabinetActionState["status"], "idle" | "saved">, string> = {
  invalid: "Не удалось подготовить кабинет. Обновите страницу и повторите.",
  forbidden: "Нет доступа к этому действию.",
  conflict: "Кабинет уже подготовлен или для этого человека уже есть аккаунт. Обновите карточку.",
  unavailable: "Подготовка не подтверждена. Проверьте подключение и повторите.",
};

// Review fix: "invalid"/"conflict"/"unavailable" each tell the user to
// refresh (see MESSAGES above) but previously rendered no way to do it —
// "forbidden" is excluded: a permission gap, where a refresh changes
// nothing.
const REFRESH_ON_STATUS = new Set<PrepareLeadCabinetActionState["status"]>([
  "invalid",
  "conflict",
  "unavailable",
]);

/**
 * «Подготовить кабинет» (unified workflow S7, plan §4): for a site/WhatsApp
 * lead with no platform анкета and no linked case yet. Calls
 * `platform.prepare_lead_cabinet_v1` (migration 184) — creates the pending,
 * curator-less cabinet case, nothing more. Invite dispatch stays a SEPARATE,
 * already admin-gated flow the case page owns (StudentPortalAccessCard);
 * that gate is not widened here, per the migration's own documented outcome
 * — a real, honest gap for a cabinet-prepared case, not hidden.
 */
export function PrepareLeadCabinetAction({ leadId, requestId }: Readonly<{ leadId: string; requestId: string }>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    prepareLeadCabinetAction,
    { status: "idle", requestId, leadId, studentCaseId: null } as PrepareLeadCabinetActionState,
  );
  useEffect(() => {
    if (state.status === "saved") router.refresh();
  }, [router, state.status]);

  if (state.status === "saved" && state.studentCaseId) {
    return (
      <p className="text-sm text-fg-2" role="status">
        Кабинет подготовлен.{" "}
        <Link className="font-semibold text-accent hover:underline" href={`/v3/profile?case=${encodeURIComponent(state.studentCaseId)}&tab=anketa`}>
          Открыть дело
        </Link>
        {" "}· «Приглашение отправляет администратор из дела».
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <p className="text-sm text-fg-2">Анкета в платформе не заполнена. Можно подготовить кабинет вручную.</p>
      <button type="submit" disabled={pending} className={cn(btnCls, "min-h-11")}>
        {pending ? "Готовим…" : "Подготовить кабинет"}
      </button>
      {state.status !== "idle" && state.status !== "saved" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-fg-2">{MESSAGES[state.status]}</p>
          {REFRESH_ON_STATUS.has(state.status) ? (
            <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={() => router.refresh()}>
              Обновить
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
