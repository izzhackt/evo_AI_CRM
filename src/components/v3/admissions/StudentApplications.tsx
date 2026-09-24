"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { decideStudentApplicationAction } from "@/lib/student-application-actions";
import {
  type StudentApplication,
  type StudentApplicationActionState,
} from "@/lib/student-application-contract";
import { formatStudentApplicationAnswers, submittedDate } from "@/lib/student-application-presentation";

const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-control-edge bg-surface px-3 py-2 text-sm text-fg";

export function StudentApplicationAnswers({ application }: { application: StudentApplication }) {
  const answers = [...formatStudentApplicationAnswers(application.questionnaire), { label: "Почта", value: application.email }];
  return <section className="min-w-0 rounded-[10px] border border-border bg-surface" aria-label="Заполнено студентом">
    <div className="border-b border-border px-4 py-3">
      <h3 className="t-item text-fg">Заполнено студентом</h3>
      <p className="mt-1 text-sm text-fg-2">Отправлено {submittedDate(application.submittedAt)}. Сведения требуют проверки.</p>
    </div>
    <dl className="grid min-w-0 divide-y divide-border">
      {answers.map(({ label, value }) => <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
        <dt className="text-sm text-fg-2">{label}</dt><dd className="min-w-0 break-words text-sm text-fg">{value}</dd>
      </div>)}
    </dl>
  </section>;
}

/**
 * Access-only decision (unified workflow S1): direction/curator pickers are
 * gone — approving only opens the portal cabinet, never a curator assignment
 * (that now happens only through a Sales report handoff, a later slice).
 * Reused by both the Продажи «Заявки» queue and the lead-card «Доступ к
 * платформе» block, so it stays a small, self-contained form.
 */
export function ApplicationDecision({ application, requestId }: { application: StudentApplication; requestId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<StudentApplicationActionState, FormData>(decideStudentApplicationAction, { status: "idle" });
  const [draft, setDraft] = useState({ decision: "approve", reason: "", requestId });
  const currentResult = state.requestId === draft.requestId ? state.status : "idle";
  const locked = pending || currentResult === "saved" || currentResult === "conflict";
  function change(values: Partial<typeof draft>) {
    setDraft((previous) => ({ ...previous, ...values, requestId: crypto.randomUUID() }));
  }
  useEffect(() => {
    if (currentResult === "saved") router.refresh();
  }, [currentResult, router]);
  const message = pending ? "Сохраняем решение…"
    : currentResult === "saved" ? "Решение сохранено. Обновляем…"
    : currentResult === "invalid" ? "Проверьте причину отказа."
    : currentResult === "forbidden" ? "Недостаточно прав для этого решения."
    : currentResult === "conflict" ? "Заявка уже изменилась или связана с существующим аккаунтом. Обновите данные перед решением."
    : currentResult === "unavailable" ? "Не удалось подтвердить сохранение. Повторите отправку с теми же данными."
    : "";
  return <form action={action} className="space-y-4 rounded-[10px] border border-border bg-surface p-4" aria-label="Решение по заявке" aria-busy={pending}>
    <input type="hidden" name="application_id" value={application.id} />
    <input type="hidden" name="expected_revision" value={application.revision} />
    <input type="hidden" name="request_id" value={draft.requestId} />
    <fieldset disabled={locked} className="min-w-0 space-y-4">
      <legend className="mb-3 text-sm font-semibold text-fg">Решение</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {[{ value: "approve", label: "Одобрить" }, { value: "reject", label: "Отклонить" }].map(({ value, label }) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg">
          <input type="radio" name="decision" value={value} checked={draft.decision === value} onChange={() => change({ decision: value })} className="accent-accent" />{label}
        </label>)}
      </div>
      {draft.decision === "approve" ? <>
        <input type="hidden" name="reason" value="" />
        <p className="text-sm text-fg-2">После одобрения студент получит доступ к личному кабинету.</p>
      </> : <label className="block text-sm text-fg-2">Причина отказа — её увидит студент
        <textarea name="reason" required minLength={3} maxLength={1000} rows={3} value={draft.reason} onChange={(event) => change({ reason: event.target.value })} className={inputClass} />
      </label>}
      <button type="submit" className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? "Сохраняем…" : draft.decision === "approve" ? "Одобрить и открыть кабинет" : "Отклонить заявку"}
      </button>
    </fieldset>
    <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-fg-2">{message}</div>
    {currentResult === "conflict" ? <button type="button" className="min-h-11 text-sm font-semibold text-accent hover:underline" onClick={() => router.refresh()}>Обновить заявку</button> : null}
  </form>;
}
