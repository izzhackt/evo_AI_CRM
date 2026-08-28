"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Card, btnCls, btnGhostCls, cn, inputCls, labelCls } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  assertCanonicalFinanceStopAction,
  createCanonicalUniversityApplicationAction,
  releaseCanonicalFinanceStopAction,
  transitionCanonicalUniversityApplicationAction,
  transitionCanonicalVisaMilestoneAction,
  updateCanonicalUniversityApplicationAction,
  type CanonicalAdmissionsOperationsActionState,
} from "@/lib/server/canonical-admissions-operations-actions";
import type {
  CanonicalFinanceStopRow,
  CanonicalStudentCaseStatus,
  CanonicalUniversityApplicationRow,
  CanonicalUniversityApplicationStatus,
  CanonicalVisaMilestoneRow,
  CanonicalVisaMilestoneStatus,
} from "@/lib/server/canonical-crm-repository";

export type CanonicalAdmissionsOperationsRequestIds = Readonly<{
  createApplication: string;
  applications: Readonly<
    Record<
      string,
      Readonly<{
        update: string;
        submitted: string;
        accepted: string;
        rejected: string;
        withdrawn: string;
      }>
    >
  >;
  visaMilestones: Readonly<
    Record<
      string,
      Readonly<{
        in_progress: string;
        completed: string;
        blocked: string;
      }>
    >
  >;
  finance: Readonly<{ assert: string; release: string }>;
}>;

const COPY = {
  ru: {
    title: "Операции Admissions",
    description: "Заявки, визовые этапы и финансовый стоп работают только через каноническую PostgreSQL-модель.",
    inactive: "Кейс не активен. Операции доступны только после активной передачи из Sales.",
    applications: "Заявки",
    applicationsDescription: "Создайте черновик, задайте следующее действие и проведите заявку до результата.",
    createApplication: "Новая заявка",
    institution: "Университет",
    program: "Программа",
    intake: "Набор",
    nextAction: "Следующее действие",
    nextActionAt: "Срок следующего действия",
    create: "Создать",
    update: "Сохранить следующее действие",
    submit: "Подать",
    accept: "Принять",
    reject: "Отклонить",
    withdraw: "Отозвать",
    reason: "Причина",
    reasonRequired: "Причина обязательна и останется в журнале событий.",
    noApplications: "Заявок пока нет.",
    financeBlocksSubmission: "Финансовый стоп активен: сервер отклонит подачу заявки и продвижение визового этапа «Подача».",
    visa: "Виза",
    visaDescription: "Шесть фиксированных этапов создаются при передаче кейса.",
    start: "Начать",
    resume: "Возобновить",
    complete: "Завершить",
    block: "Заблокировать",
    dueAt: "Срок этапа",
    finance: "Финансовый стоп",
    financeDescription: "Это только стоп-фактор кейса, не платёжный реестр.",
    noStop: "Активного финансового стопа нет.",
    stopActive: "Стоп активен",
    stopReleased: "Стоп снят",
    assertStop: "Установить стоп",
    releaseStop: "Снять стоп",
    adminReleaseOnly: "Снять активный стоп может только Admin.",
    changedBy: "Изменила роль",
    version: "Версия",
    saving: "Сохранение…",
    states: {
      saved: "Сохранено.", invalid: "Проверьте поля формы.", forbidden: "У роли нет права на это действие.",
      stale: "Данные изменились. Экран обновлён — повторите действие.", request_conflict: "Этот идентификатор запроса уже использован иначе.",
      blocked: "Действие заблокировано текущим состоянием кейса или финансовым стопом.", unavailable: "PostgreSQL недоступен. Запасного пути нет.",
    },
    appStatuses: { draft: "Черновик", submitted: "Подана", accepted: "Принята", rejected: "Отклонена", withdrawn: "Отозвана" },
    visaStatuses: { pending: "Ожидает", in_progress: "В работе", completed: "Завершён", blocked: "Заблокирован" },
    visaKinds: { document_preparation: "Подготовка документов", appointment: "Запись", submission: "Подача", biometrics: "Биометрия", interview: "Интервью", decision: "Решение" },
  },
  ky: {
    title: "Admissions операциялары",
    description: "Арыздар, виза этаптары жана каржылык стоп каноникалык PostgreSQL модели аркылуу гана иштейт.",
    inactive: "Кейс активдүү эмес. Операциялар Sales бөлүмүнөн активдүү өткөрүлгөндөн кийин гана жеткиликтүү.",
    applications: "Арыздар",
    applicationsDescription: "Черновик түзүп, кийинки аракетти белгилеп, арызды жыйынтыкка чейин жүргүзүңүз.",
    createApplication: "Жаңы арыз",
    institution: "Университет",
    program: "Программа",
    intake: "Кабыл алуу мезгили",
    nextAction: "Кийинки аракет",
    nextActionAt: "Кийинки аракеттин мөөнөтү",
    create: "Түзүү",
    update: "Кийинки аракетти сактоо",
    submit: "Тапшыруу",
    accept: "Кабыл алуу",
    reject: "Четке кагуу",
    withdraw: "Кайтарып алуу",
    reason: "Себеп",
    reasonRequired: "Себеп милдеттүү жана окуялар журналына сакталат.",
    noApplications: "Азырынча арыздар жок.",
    financeBlocksSubmission: "Каржылык стоп активдүү: сервер арызды тапшырууну жана «Тапшыруу» виза этабын жылдырууну четке кагат.",
    visa: "Виза",
    visaDescription: "Алты туруктуу этап кейс өткөрүлгөндө түзүлөт.",
    start: "Баштоо",
    resume: "Улантуу",
    complete: "Аяктоо",
    block: "Бөгөт коюу",
    dueAt: "Этаптын мөөнөтү",
    finance: "Каржылык стоп",
    financeDescription: "Бул төлөм реестри эмес, кейстин стоп-фактору гана.",
    noStop: "Активдүү каржылык стоп жок.",
    stopActive: "Стоп активдүү",
    stopReleased: "Стоп алынды",
    assertStop: "Стоп коюу",
    releaseStop: "Стопту алуу",
    adminReleaseOnly: "Активдүү стопту Admin гана ала алат.",
    changedBy: "Өзгөрткөн роль",
    version: "Версия",
    saving: "Сакталууда…",
    states: {
      saved: "Сакталды.", invalid: "Форма талааларын текшериңиз.", forbidden: "Бул аракетке ролдун укугу жок.",
      stale: "Маалымат өзгөрдү. Экран жаңырды — аракетти кайталаңыз.", request_conflict: "Бул сурам идентификатору башка мазмунда колдонулган.",
      blocked: "Аракет кейстин учурдагы абалы же каржылык стоп менен бөгөттөлгөн.", unavailable: "PostgreSQL жеткиликсиз. Запастык жол жок.",
    },
    appStatuses: { draft: "Черновик", submitted: "Тапшырылды", accepted: "Кабыл алынды", rejected: "Четке кагылды", withdrawn: "Кайтарылды" },
    visaStatuses: { pending: "Күтүүдө", in_progress: "Иш жүрүүдө", completed: "Аяктады", blocked: "Бөгөттөлдү" },
    visaKinds: { document_preparation: "Документтерди даярдоо", appointment: "Жазылуу", submission: "Тапшыруу", biometrics: "Биометрия", interview: "Маек", decision: "Чечим" },
  },
  en: {
    title: "Admissions operations",
    description: "Applications, visa milestones and the finance stop operate only through the canonical PostgreSQL model.",
    inactive: "This case is not active. Operations require an active handoff from Sales.",
    applications: "Applications",
    applicationsDescription: "Create a draft, set the next action and move the application to a final outcome.",
    createApplication: "New application",
    institution: "University",
    program: "Program",
    intake: "Intake",
    nextAction: "Next action",
    nextActionAt: "Next-action due time",
    create: "Create",
    update: "Save next action",
    submit: "Submit",
    accept: "Accept",
    reject: "Reject",
    withdraw: "Withdraw",
    reason: "Reason",
    reasonRequired: "A reason is required and remains in the business event log.",
    noApplications: "No applications yet.",
    financeBlocksSubmission: "A finance stop is active: the server will reject application submission and progress of the visa Submission milestone.",
    visa: "Visa",
    visaDescription: "Six fixed milestones are created when the case is handed off.",
    start: "Start",
    resume: "Resume",
    complete: "Complete",
    block: "Block",
    dueAt: "Milestone due time",
    finance: "Finance stop",
    financeDescription: "This is a case stop-factor only, not a payment ledger.",
    noStop: "There is no active finance stop.",
    stopActive: "Stop active",
    stopReleased: "Stop released",
    assertStop: "Assert stop",
    releaseStop: "Release stop",
    adminReleaseOnly: "Only Admin can release an active stop.",
    changedBy: "Changed by role",
    version: "Version",
    saving: "Saving…",
    states: {
      saved: "Saved.", invalid: "Check the form fields.", forbidden: "This role cannot perform the action.",
      stale: "The data changed. The screen refreshed; try again.", request_conflict: "This request identifier was already used for different input.",
      blocked: "The action is blocked by the current case state or finance stop.", unavailable: "PostgreSQL is unavailable. There is no fallback path.",
    },
    appStatuses: { draft: "Draft", submitted: "Submitted", accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn" },
    visaStatuses: { pending: "Pending", in_progress: "In progress", completed: "Completed", blocked: "Blocked" },
    visaKinds: { document_preparation: "Document preparation", appointment: "Appointment", submission: "Submission", biometrics: "Biometrics", interview: "Interview", decision: "Decision" },
  },
} as const;

type Copy = (typeof COPY)[Locale];

function initialState(requestId: string): CanonicalAdmissionsOperationsActionState {
  return { status: "idle", requestId, objectId: null, studentCaseId: null, objectStatus: null, version: null, changedAt: null };
}

function toInputTimestamp(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function useRefreshAfterAction(state: CanonicalAdmissionsOperationsActionState) {
  const router = useRouter();
  useEffect(() => {
    if (["saved", "stale", "blocked"].includes(state.status)) router.refresh();
  }, [router, state.changedAt, state.status]);
}

function ActionMessage({ state, copy }: Readonly<{ state: CanonicalAdmissionsOperationsActionState; copy: Copy }>) {
  if (state.status === "idle") return null;
  return <p role="status" className={cn("text-[12px]", state.status === "saved" ? "text-ok" : "text-danger")}>{copy.states[state.status]}</p>;
}

function IsoDateTimeField({ name, label, initialValue }: Readonly<{ name: string; label: string; initialValue: string | null }>) {
  const [value, setValue] = useState(initialValue ?? "");
  return (
    <label>
      <span className={labelCls}>{label}</span>
      <input type="hidden" name={name} value={value} />
      <input
        type="datetime-local"
        step={60}
        defaultValue={toInputTimestamp(initialValue)}
        className={inputCls}
        onChange={(event) => setValue(event.currentTarget.value ? new Date(event.currentTarget.value).toISOString() : "")}
      />
    </label>
  );
}

function CreateApplicationForm({ studentCaseId, requestId, copy }: Readonly<{ studentCaseId: string; requestId: string; copy: Copy }>) {
  const [state, action, pending] = useActionState(createCanonicalUniversityApplicationAction, initialState(requestId));
  useRefreshAfterAction(state);
  return (
    <form action={action} className="border-y border-border bg-surface-2 px-4 py-4" data-testid="canonical-university-application-create-form">
      <h3 className="text-[13px] font-semibold text-fg">{copy.createApplication}</h3>
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="student_case_id" value={studentCaseId} />
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label><span className={labelCls}>{copy.institution}</span><input name="institution_name" required maxLength={200} className={inputCls} /></label>
        <label><span className={labelCls}>{copy.program}</span><input name="program_name" required maxLength={200} className={inputCls} /></label>
        <label><span className={labelCls}>{copy.intake}</span><input name="target_intake" required maxLength={100} className={inputCls} /></label>
        <label className="md:col-span-2"><span className={labelCls}>{copy.nextAction}</span><input name="next_action" maxLength={500} className={inputCls} /></label>
        <IsoDateTimeField name="next_action_at" label={copy.nextActionAt} initialValue={null} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="submit" disabled={pending} className={btnCls}>{pending ? copy.saving : copy.create}</button><ActionMessage state={state} copy={copy} /></div>
    </form>
  );
}

function ApplicationUpdateForm({ application, requestId, copy }: Readonly<{ application: CanonicalUniversityApplicationRow; requestId: string; copy: Copy }>) {
  const [state, action, pending] = useActionState(updateCanonicalUniversityApplicationAction, initialState(requestId));
  useRefreshAfterAction(state);
  return (
    <form action={action} className="mt-4 grid gap-3 md:grid-cols-[1fr_260px_auto] md:items-end" data-testid="canonical-university-application-update-form">
      <input type="hidden" name="request_id" value={state.requestId} /><input type="hidden" name="application_id" value={application.applicationId} /><input type="hidden" name="expected_version" value={application.version} />
      <label><span className={labelCls}>{copy.nextAction}</span><input name="next_action" defaultValue={application.nextAction ?? ""} maxLength={500} className={inputCls} /></label>
      <IsoDateTimeField name="next_action_at" label={copy.nextActionAt} initialValue={application.nextActionAt} />
      <button type="submit" disabled={pending} className={btnGhostCls}>{pending ? copy.saving : copy.update}</button>
      <div className="md:col-span-3"><ActionMessage state={state} copy={copy} /></div>
    </form>
  );
}

function ApplicationTransitionForm({ application, toStatus, requestId, copy }: Readonly<{ application: CanonicalUniversityApplicationRow; toStatus: Exclude<CanonicalUniversityApplicationStatus, "draft">; requestId: string; copy: Copy }>) {
  const [state, action, pending] = useActionState(transitionCanonicalUniversityApplicationAction, initialState(requestId));
  useRefreshAfterAction(state);
  const requiresReason = toStatus === "rejected" || toStatus === "withdrawn";
  const label = toStatus === "submitted" ? copy.submit : toStatus === "accepted" ? copy.accept : toStatus === "rejected" ? copy.reject : copy.withdraw;
  return (
    <form action={action} className={cn("flex min-w-0 flex-wrap items-end gap-2", requiresReason && "grow")} data-testid="canonical-university-application-transition-form" data-to-status={toStatus}>
      <input type="hidden" name="request_id" value={state.requestId} /><input type="hidden" name="application_id" value={application.applicationId} /><input type="hidden" name="expected_version" value={application.version} /><input type="hidden" name="to_status" value={toStatus} />
      {requiresReason ? <label className="min-w-[220px] grow"><span className={labelCls}>{copy.reason}</span><input name="reason" required maxLength={2000} className={inputCls} placeholder={copy.reasonRequired} /></label> : <input type="hidden" name="reason" value="" />}
      <button type="submit" disabled={pending} className={toStatus === "accepted" ? btnCls : btnGhostCls}>{pending ? copy.saving : label}</button>
      <ActionMessage state={state} copy={copy} />
    </form>
  );
}

function ApplicationItem({ application, requestIds, copy, active }: Readonly<{ application: CanonicalUniversityApplicationRow; requestIds: CanonicalAdmissionsOperationsRequestIds["applications"][string]; copy: Copy; active: boolean }>) {
  const editable = active && (application.status === "draft" || application.status === "submitted");
  return (
    <li className="py-5 first:pt-0 last:pb-0" data-testid="canonical-university-application" data-application-id={application.applicationId} data-status={application.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-[13.5px] font-semibold text-fg">{application.institutionName}</h3><p className="mt-1 text-[12.5px] text-fg-2">{application.programName} · {application.targetIntake}</p></div>
        <span className="rounded-full bg-info-weak px-2 py-0.5 text-[10.5px] font-semibold text-info">{copy.appStatuses[application.status]}</span>
      </div>
      <p className="mt-2 text-[11.5px] text-fg-3">{copy.version}: {application.version}</p>
      {editable ? <ApplicationUpdateForm application={application} requestId={requestIds.update} copy={copy} /> : null}
      {editable ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          {application.status === "draft" ? <ApplicationTransitionForm application={application} toStatus="submitted" requestId={requestIds.submitted} copy={copy} /> : null}
          {application.status === "submitted" ? <ApplicationTransitionForm application={application} toStatus="accepted" requestId={requestIds.accepted} copy={copy} /> : null}
          {application.status === "submitted" ? <ApplicationTransitionForm application={application} toStatus="rejected" requestId={requestIds.rejected} copy={copy} /> : null}
          <ApplicationTransitionForm application={application} toStatus="withdrawn" requestId={requestIds.withdrawn} copy={copy} />
        </div>
      ) : null}
    </li>
  );
}

function VisaTransitionForm({ milestone, toStatus, requestId, copy }: Readonly<{ milestone: CanonicalVisaMilestoneRow; toStatus: Exclude<CanonicalVisaMilestoneStatus, "pending">; requestId: string; copy: Copy }>) {
  const [state, action, pending] = useActionState(transitionCanonicalVisaMilestoneAction, initialState(requestId));
  useRefreshAfterAction(state);
  const requiresReason = toStatus === "blocked";
  const editableSchedule = toStatus === "in_progress";
  const label = toStatus === "blocked" ? copy.block : toStatus === "completed" ? copy.complete : milestone.status === "blocked" ? copy.resume : copy.start;
  return (
    <form action={action} className="grid gap-3 md:grid-cols-[1fr_230px_230px_auto] md:items-end" data-testid="canonical-visa-milestone-transition-form" data-to-status={toStatus}>
      <input type="hidden" name="request_id" value={state.requestId} /><input type="hidden" name="visa_milestone_id" value={milestone.visaMilestoneId} /><input type="hidden" name="expected_version" value={milestone.version} /><input type="hidden" name="to_status" value={toStatus} />
      {requiresReason ? <label><span className={labelCls}>{copy.reason}</span><input name="reason" required maxLength={2000} className={inputCls} placeholder={copy.reasonRequired} /></label> : <input type="hidden" name="reason" value="" />}
      {editableSchedule ? <><label><span className={labelCls}>{copy.nextAction}</span><input name="next_action" defaultValue={milestone.nextAction ?? ""} maxLength={500} className={inputCls} /></label><IsoDateTimeField name="next_action_at" label={copy.nextActionAt} initialValue={milestone.nextActionAt} /><IsoDateTimeField name="due_at" label={copy.dueAt} initialValue={milestone.dueAt} /></> : <><input type="hidden" name="next_action" value={toStatus === "completed" ? "" : milestone.nextAction ?? ""} /><input type="hidden" name="next_action_at" value={toStatus === "completed" ? "" : milestone.nextActionAt ?? ""} /><input type="hidden" name="due_at" value={milestone.dueAt ?? ""} /></>}
      <button type="submit" disabled={pending} className={toStatus === "completed" ? btnCls : btnGhostCls}>{pending ? copy.saving : label}</button>
      <div className="md:col-span-4"><ActionMessage state={state} copy={copy} /></div>
    </form>
  );
}

function VisaMilestoneItem({ milestone, requestIds, copy, active }: Readonly<{ milestone: CanonicalVisaMilestoneRow; requestIds: CanonicalAdmissionsOperationsRequestIds["visaMilestones"][string]; copy: Copy; active: boolean }>) {
  return (
    <li className="py-5 first:pt-0 last:pb-0" data-testid="canonical-visa-milestone" data-kind={milestone.milestoneKind} data-status={milestone.status}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-[13.5px] font-semibold text-fg">{copy.visaKinds[milestone.milestoneKind]}</h3>{milestone.blockedReason ? <p className="mt-1 text-[12px] text-danger">{milestone.blockedReason}</p> : null}</div><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold text-fg-2">{copy.visaStatuses[milestone.status]}</span></div>
      <p className="mt-2 text-[11.5px] text-fg-3">{copy.version}: {milestone.version}</p>
      {active && milestone.status !== "completed" ? <div className="mt-4 grid gap-3 border-t border-border pt-4">
        {milestone.status === "pending" || milestone.status === "blocked" ? <VisaTransitionForm milestone={milestone} toStatus="in_progress" requestId={requestIds.in_progress} copy={copy} /> : null}
        {milestone.status === "in_progress" ? <VisaTransitionForm milestone={milestone} toStatus="completed" requestId={requestIds.completed} copy={copy} /> : null}
        {milestone.status === "pending" || milestone.status === "in_progress" ? <VisaTransitionForm milestone={milestone} toStatus="blocked" requestId={requestIds.blocked} copy={copy} /> : null}
      </div> : null}
    </li>
  );
}

function AssertFinanceStopForm({ studentCaseId, financeStop, requestId, copy }: Readonly<{ studentCaseId: string; financeStop: CanonicalFinanceStopRow | null; requestId: string; copy: Copy }>) {
  const [state, action, pending] = useActionState(assertCanonicalFinanceStopAction, initialState(requestId));
  useRefreshAfterAction(state);
  return <form action={action} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="canonical-finance-stop-assert-form"><input type="hidden" name="request_id" value={state.requestId} /><input type="hidden" name="student_case_id" value={studentCaseId} /><input type="hidden" name="expected_version" value={financeStop?.version ?? 0} /><label className="min-w-0 grow"><span className={labelCls}>{copy.reason}</span><textarea name="reason" required maxLength={2000} rows={2} className={cn(inputCls, "h-auto resize-y py-2")} placeholder={copy.reasonRequired} /></label><button type="submit" disabled={pending} className={btnCls}>{pending ? copy.saving : copy.assertStop}</button><ActionMessage state={state} copy={copy} /></form>;
}

function ReleaseFinanceStopForm({ financeStop, requestId, copy }: Readonly<{ financeStop: CanonicalFinanceStopRow; requestId: string; copy: Copy }>) {
  const [state, action, pending] = useActionState(releaseCanonicalFinanceStopAction, initialState(requestId));
  useRefreshAfterAction(state);
  return <form action={action} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="canonical-finance-stop-release-form"><input type="hidden" name="request_id" value={state.requestId} /><input type="hidden" name="finance_stop_id" value={financeStop.financeStopId} /><input type="hidden" name="expected_version" value={financeStop.version} /><label className="min-w-0 grow"><span className={labelCls}>{copy.reason}</span><textarea name="reason" required maxLength={2000} rows={2} className={cn(inputCls, "h-auto resize-y py-2")} placeholder={copy.reasonRequired} /></label><button type="submit" disabled={pending} className={btnCls}>{pending ? copy.saving : copy.releaseStop}</button><ActionMessage state={state} copy={copy} /></form>;
}

export function CanonicalAdmissionsOperationsPanel({ locale, actorRole, studentCaseId, studentCaseStatus, applications, visaMilestones, financeStop, requestIds }: Readonly<{ locale: Locale; actorRole: FixedRole; studentCaseId: string; studentCaseStatus: CanonicalStudentCaseStatus; applications: readonly CanonicalUniversityApplicationRow[]; visaMilestones: readonly CanonicalVisaMilestoneRow[]; financeStop: CanonicalFinanceStopRow | null; requestIds: CanonicalAdmissionsOperationsRequestIds }>) {
  const copy = COPY[locale];
  const active = studentCaseStatus === "active";
  const financeStopped = financeStop?.isStopped === true;
  return (
    <section className="space-y-8 border-t border-border pt-6" data-testid="canonical-admissions-operations">
      <header><h2 className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{copy.title}</h2><p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-fg-3">{copy.description}</p></header>
      {!active ? <p className="border-y border-border py-3 text-[12.5px] text-warn" role="status">{copy.inactive}</p> : null}
      {financeStopped ? <p id="finance-stop-warning" className="border-y border-danger/30 bg-danger-weak px-4 py-3 text-[12.5px] text-danger" role="status">{copy.financeBlocksSubmission}</p> : null}

      <section id="applications" className="scroll-mt-24"><h3 className="text-[15px] font-semibold text-fg">{copy.applications}</h3><p className="mt-1 text-[12.5px] text-fg-3">{copy.applicationsDescription}</p>
        {active ? <div className="mt-4"><CreateApplicationForm studentCaseId={studentCaseId} requestId={requestIds.createApplication} copy={copy} /></div> : null}
        {applications.length === 0 ? <p className="mt-4 text-[12.5px] text-fg-3">{copy.noApplications}</p> : <Card className="mt-4"><ul className="divide-y divide-border">{applications.map((application) => { const ids = requestIds.applications[application.applicationId]; return ids ? <ApplicationItem key={application.applicationId} application={application} requestIds={ids} copy={copy} active={active} /> : null; })}</ul></Card>}
      </section>

      <section id="visa" className="scroll-mt-24 border-t border-border pt-6"><h3 className="text-[15px] font-semibold text-fg">{copy.visa}</h3><p className="mt-1 text-[12.5px] text-fg-3">{copy.visaDescription}</p><Card className="mt-4"><ul className="divide-y divide-border">{visaMilestones.map((milestone) => { const ids = requestIds.visaMilestones[milestone.visaMilestoneId]; return ids ? <VisaMilestoneItem key={milestone.visaMilestoneId} milestone={milestone} requestIds={ids} copy={copy} active={active} /> : null; })}</ul></Card></section>

      <section id="finance" className="scroll-mt-24 border-t border-border pt-6"><h3 className="text-[15px] font-semibold text-fg">{copy.finance}</h3><p className="mt-1 text-[12.5px] text-fg-3">{copy.financeDescription}</p>
        <div className="mt-4 border-y border-border py-4" data-testid="canonical-finance-stop" data-is-stopped={financeStopped ? "true" : "false"} data-version={financeStop?.version ?? 0}>
          <div className="flex flex-wrap items-center gap-3"><span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", financeStopped ? "bg-danger-weak text-danger" : "bg-ok-weak text-ok")}>{financeStopped ? copy.stopActive : financeStop ? copy.stopReleased : copy.noStop}</span>{financeStop ? <span className="text-[11.5px] text-fg-3">{copy.changedBy}: {financeStop.changedByRole} · {copy.version}: {financeStop.version}</span> : null}</div>
          {financeStop ? <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-fg-2">{financeStop.reason}</p> : null}
          {active && !financeStopped ? <AssertFinanceStopForm studentCaseId={studentCaseId} financeStop={financeStop} requestId={requestIds.finance.assert} copy={copy} /> : null}
          {active && financeStopped && financeStop && actorRole === "admin" ? <ReleaseFinanceStopForm financeStop={financeStop} requestId={requestIds.finance.release} copy={copy} /> : null}
          {financeStopped && actorRole !== "admin" ? <p className="mt-3 text-[12px] text-fg-3">{copy.adminReleaseOnly}</p> : null}
        </div>
      </section>
    </section>
  );
}
