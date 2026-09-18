"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { decideStudentApplicationAction } from "@/lib/student-application-actions";
import {
  STUDENT_APPLICATION_DIRECTIONS,
  type AdmissionsDirection,
  type StudentApplication,
  type StudentApplicationActionState,
  type StudentApplicationCurator,
  type StudentApplicationQueue,
} from "@/lib/student-application-contract";
import { formatStudentApplicationAnswers } from "@/lib/student-application-presentation";
import { DIRECTION_LABELS } from "@/components/v3/profile/admissions-view";

const STATUS_LABELS = { pending: "На рассмотрении", approved: "Одобрена", rejected: "Отклонена" };
const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-control-edge bg-surface px-3 py-2 text-sm text-fg";

function submittedDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function StudentApplicationsNav({ current, pendingCount }: { current: "cases" | "applications"; pendingCount: number | null }) {
  return <nav aria-label="Поступление" className="flex gap-1 border-b border-border text-sm font-semibold">
    {([{ id: "cases", href: "/v3/profile", label: "Рабочий список" }, { id: "applications", href: "/v3/admissions-requests", label: "Заявки" }] as const).map((item) => <Link
      key={item.id} href={item.href} aria-current={current === item.id ? "page" : undefined}
      className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 ${current === item.id ? "border-accent text-accent" : "border-transparent text-fg-2 hover:text-fg"}`}
    >{item.label}{item.id === "applications" && pendingCount !== null ? <span className="rounded-full bg-bg px-2 py-0.5 text-xs tabular-nums" aria-label={`${pendingCount} на рассмотрении`}>{pendingCount}</span> : null}</Link>)}
  </nav>;
}

export function StudentApplicationAnswers({ application }: { application: StudentApplication }) {
  const answers = [...formatStudentApplicationAnswers(application.questionnaire), { label: "Почта", value: application.email }];
  return <section className="min-w-0 rounded-[10px] border border-border bg-surface" aria-label="Заполнено студентом">
    <div className="border-b border-border px-4 py-3">
      <h3 className="text-sm font-semibold text-fg">Заполнено студентом</h3>
      <p className="mt-1 text-sm text-fg-2">Отправлено {submittedDate(application.submittedAt)}. Сведения требуют проверки.</p>
    </div>
    <dl className="grid min-w-0 divide-y divide-border">
      {answers.map(({ label, value }) => <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
        <dt className="text-sm text-fg-2">{label}</dt><dd className="min-w-0 break-words text-sm text-fg">{value}</dd>
      </div>)}
    </dl>
  </section>;
}

function ApplicationDecision({ application, curators, requestId }: { application: StudentApplication; curators: StudentApplicationCurator[]; requestId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<StudentApplicationActionState, FormData>(decideStudentApplicationAction, { status: "idle" });
  const [draft, setDraft] = useState({ decision: "approve", direction: "", curator: "", reason: "", requestId });
  const currentResult = state.requestId === draft.requestId ? state.status : "idle";
  const locked = pending || currentResult === "saved" || currentResult === "conflict";
  const eligibleCurators = curators.filter((curator) => curator.directions.includes(draft.direction as AdmissionsDirection));
  function change(values: Partial<typeof draft>) {
    setDraft((previous) => ({ ...previous, ...values, requestId: crypto.randomUUID() }));
  }
  useEffect(() => {
    if (currentResult === "saved") router.refresh();
  }, [currentResult, router]);
  const message = pending ? "Сохраняем решение…"
    : currentResult === "saved" ? "Решение сохранено. Обновляем заявку…"
    : currentResult === "invalid" ? "Проверьте направление, куратора и причину отказа."
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
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-fg-2">Направление
            <select name="admissions_direction" required value={draft.direction} onChange={(event) => change({ direction: event.target.value, curator: "" })} className={inputClass}>
              <option value="">Выберите направление</option>
              {STUDENT_APPLICATION_DIRECTIONS.map((direction) => <option key={direction} value={direction}>{DIRECTION_LABELS[direction]}</option>)}
            </select>
          </label>
          <label className="text-sm text-fg-2">Куратор
            <select name="curator_membership_id" required value={draft.curator} onChange={(event) => change({ curator: event.target.value })} disabled={!draft.direction || eligibleCurators.length === 0} className={inputClass}>
              <option value="">Выберите куратора</option>
              {eligibleCurators.map((curator) => <option key={curator.membershipId} value={curator.membershipId}>{curator.displayName}</option>)}
            </select>
          </label>
        </div>
        {draft.direction && eligibleCurators.length === 0 ? <p className="text-sm text-fg-2">Для этого направления нет доступного куратора. Назначение должен проверить администратор.</p> : null}
        <p className="text-sm text-fg-2">После одобрения студент получит доступ к личному кабинету.</p>
      </> : <>
        <input type="hidden" name="admissions_direction" value="" />
        <input type="hidden" name="curator_membership_id" value="" />
        <label className="block text-sm text-fg-2">Причина отказа — её увидит студент
        <textarea name="reason" required minLength={3} maxLength={1000} rows={3} value={draft.reason} onChange={(event) => change({ reason: event.target.value })} className={inputClass} />
        </label>
      </>}
      <button type="submit" disabled={draft.decision === "approve" && (!draft.direction || !draft.curator)} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? "Сохраняем…" : draft.decision === "approve" ? "Одобрить и открыть кабинет" : "Отклонить заявку"}
      </button>
    </fieldset>
    <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-fg-2">{message}</div>
    {currentResult === "conflict" ? <button type="button" className="min-h-11 text-sm font-semibold text-accent hover:underline" onClick={() => router.refresh()}>Обновить заявку</button> : null}
  </form>;
}

export function StudentApplications({ queue, selectedId, requestId, readOnly }: { queue: StudentApplicationQueue; selectedId: string | null; requestId: string; readOnly: boolean }) {
  const selected = selectedId ? queue.applications.find((application) => application.id === selectedId) : queue.applications[0];
  return <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
    <section id="application-list" className="min-w-0 scroll-mt-6" aria-label="Список заявок">
      <h2 className="mb-3 text-sm font-semibold text-fg">На рассмотрении: {queue.pendingCount}</h2>
      {queue.applications.length === 0 ? <p className="text-sm text-fg-2">Заявок пока нет.</p> : <ul className="overflow-hidden rounded-[10px] border border-border bg-surface">
        {queue.applications.map((application) => <li key={application.id} className="border-b border-border last:border-0">
          <Link href={`/v3/admissions-requests?application=${encodeURIComponent(application.id)}#application-details`} aria-current={selected?.id === application.id ? "page" : undefined} className={`block min-w-0 border-s-2 p-4 hover:bg-bg ${selected?.id === application.id ? "border-accent bg-bg" : "border-transparent"}`}>
            <span className="block break-words text-sm font-semibold text-fg">{application.questionnaire.firstName} {application.questionnaire.lastName}</span>
            <span className="mt-1 block break-all text-sm text-fg-2">{application.email}</span>
            <span className="mt-2 block text-xs text-fg-2">{STATUS_LABELS[application.status]} · {submittedDate(application.submittedAt)}</span>
          </Link>
        </li>)}
      </ul>}
      {queue.applications.length === 100 ? <p className="mt-3 text-sm text-fg-2">Показаны первые 100 заявок; на рассмотрении — в начале списка.</p> : null}
    </section>
    {selected ? <div className="min-w-0 space-y-4">
      <a href="#application-list" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline lg:hidden">К списку заявок</a>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="application-details" tabIndex={-1} className="min-w-0 scroll-mt-6 break-words text-lg font-semibold text-fg">{selected.questionnaire.firstName} {selected.questionnaire.lastName}</h2>
        <span className="text-sm text-fg-2">{STATUS_LABELS[selected.status]}</span>
      </div>
      <StudentApplicationAnswers application={selected} />
      {selected.status === "pending" && !readOnly ? <ApplicationDecision key={`${selected.id}:${selected.revision}`} application={selected} curators={queue.curators} requestId={requestId} /> : null}
      {selected.status === "pending" && readOnly ? <p className="text-sm text-fg-2">В режиме просмотра решения недоступны.</p> : null}
      {selected.status === "rejected" && selected.decisionReason ? <div className="rounded-[10px] border border-border bg-surface p-4"><h3 className="text-sm font-semibold text-fg">Причина отказа</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg-2">{selected.decisionReason}</p></div> : null}
      {selected.status === "approved" && selected.studentCaseId ? <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline" href={`/v3/profile?case=${encodeURIComponent(selected.studentCaseId)}&tab=anketa`}>Открыть карточку студента</Link> : null}
    </div> : selectedId ? <p role="alert" className="text-sm text-fg-2">Заявка не найдена в текущем списке. Выберите другую заявку.</p> : null}
  </div>;
}
