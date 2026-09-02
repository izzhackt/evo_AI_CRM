"use client";

import { useFormStatus } from "react-dom";

import {
  Badge,
  btnCls,
  btnGhostCls,
  cn,
  inputCls,
  labelCls,
} from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  changePlatformUniversityApplicationAction,
  createPlatformUniversityApplicationAction,
} from "@/lib/platform-admissions-actions";
import {
  PLATFORM_APPLICATION_STATUSES,
  type PlatformApplicationQueueRow,
} from "@/lib/platform-application-contract";
import {
  createPlatformFinanceStopFactorAction,
  createPlatformPaymentObligationAction,
  resolvePlatformFinanceStopFactorAction,
  settlePlatformPaymentObligationAction,
  upsertPlatformCaseVisaAction,
} from "@/lib/platform-case-operations-actions";
import {
  PLATFORM_OBLIGATION_CATEGORIES,
  PLATFORM_VISA_STATUSES,
  type PlatformCaseVisa,
} from "@/lib/platform-case-operations-contract";
import type { PlatformCaseFinanceControl } from "@/lib/platform-finance-control";

type MutationOutcome = "saved" | "invalid" | "unavailable";

export type PlatformAdmissionsOperationsFeedback = Readonly<{
  applications?: Readonly<{
    outcome: MutationOutcome;
    operation: "create" | "change" | null;
    subjectId: string | null;
  }> | null;
  caseOperations?: Readonly<{
    outcome: MutationOutcome;
    operation: "visa" | "payment-create" | "payment-settle" | null;
    subjectId: string | null;
  }> | null;
  financeStops?: Readonly<{
    outcome: MutationOutcome;
    operation: "stop-create" | "stop-resolve" | null;
    subjectId: string | null;
  }> | null;
}>;

export type PlatformAdmissionsOperationsRequestIds = Readonly<{
  createApplication: string;
  applications: Readonly<Record<string, string>>;
  visa: string;
  createPayment: string;
  settlePayments: Readonly<Record<string, string>>;
  createStops: Readonly<Record<string, string>>;
  resolveStops: Readonly<Record<string, string>>;
}>;

type Props = Readonly<{
  locale: Locale;
  studentCaseId: string;
  studentCaseState: "active" | "closed";
  authorityRole: FixedRole;
  presentationRole: FixedRole;
  applications: readonly PlatformApplicationQueueRow[];
  visa: PlatformCaseVisa | null;
  finance: PlatformCaseFinanceControl;
  requestIds: PlatformAdmissionsOperationsRequestIds;
  feedback?: PlatformAdmissionsOperationsFeedback;
}>;

const COPY = {
  ru: {
    title: "Операции кейса",
    description:
      "Заявки, виза и финансовые ограничения работают через один кейс Supabase.",
    applications: "Заявки в университеты",
    visa: "Виза",
    finance: "Финансовый контроль",
    history: "История изменений",
    createApplication: "Добавить заявку",
    institution: "Университет",
    program: "Программа",
    status: "Статус",
    evidence: "Ссылка на подтверждение",
    note: "Комментарий",
    save: "Сохранить",
    saving: "Сохраняем…",
    emptyApplications: "Заявок пока нет.",
    visaMissing: "Визовый кейс ещё не создан.",
    visaEvidence: "Подтверждение изменения визы",
    obligations: "Обязательства",
    noObligations: "Финансовых обязательств пока нет.",
    outstanding: "Остаток",
    due: "Срок",
    nextAction: "Следующее действие",
    addObligation: "Добавить обязательство",
    label: "Название",
    category: "Категория",
    amount: "Сумма",
    currency: "Валюта",
    dueDate: "Дата оплаты",
    reason: "Причина",
    confirmPayment: "Подтвердить полную оплату",
    paymentEvidence: "Подтверждение оплаты",
    assertStop: "Поставить финансовый стоп",
    blockedAction: "Что блокируется",
    stopEvidence: "Подтверждение стопа",
    activeStops: "Активные стопы",
    releaseStop: "Снять стоп (только Admin)",
    noHistory: "Истории пока нет.",
    closed: "Кейс закрыт: изменения недоступны.",
    saved: "Изменение сохранено.",
    invalid: "Изменение отклонено: проверьте поля.",
    unavailable: "Supabase не подтвердил изменение. Данные не подменялись.",
    categoryLabels: {
      evo_service_fee: "Услуга EVO",
      third_party_cost: "Сторонние расходы",
    },
  },
  ky: {
    title: "Кейс операциялары",
    description:
      "Арыздар, виза жана каржылык чектөөлөр бир Supabase кейси аркылуу иштейт.",
    applications: "Университет арыздары",
    visa: "Виза",
    finance: "Каржылык көзөмөл",
    history: "Өзгөрүүлөр тарыхы",
    createApplication: "Арыз кошуу",
    institution: "Университет",
    program: "Программа",
    status: "Статус",
    evidence: "Ырастоо шилтемеси",
    note: "Комментарий",
    save: "Сактоо",
    saving: "Сакталууда…",
    emptyApplications: "Азырынча арыз жок.",
    visaMissing: "Виза кейси али түзүлгөн эмес.",
    visaEvidence: "Виза өзгөрүүсүнүн ырастоосу",
    obligations: "Милдеттенмелер",
    noObligations: "Азырынча каржылык милдеттенме жок.",
    outstanding: "Калдык",
    due: "Мөөнөт",
    nextAction: "Кийинки аракет",
    addObligation: "Милдеттенме кошуу",
    label: "Аталышы",
    category: "Категория",
    amount: "Сумма",
    currency: "Валюта",
    dueDate: "Төлөм күнү",
    reason: "Себеп",
    confirmPayment: "Толук төлөмдү ырастоо",
    paymentEvidence: "Төлөм ырастоосу",
    assertStop: "Каржылык стоп коюу",
    blockedAction: "Эмне бөгөттөлөт",
    stopEvidence: "Стоп ырастоосу",
    activeStops: "Активдүү стоптор",
    releaseStop: "Стопту алуу (Admin гана)",
    noHistory: "Азырынча тарых жок.",
    closed: "Кейс жабык: өзгөртүү жеткиликсиз.",
    saved: "Өзгөртүү сакталды.",
    invalid: "Өзгөртүү четке кагылды: талааларды текшериңиз.",
    unavailable: "Supabase өзгөртүүнү ырастаган жок. Маалымат алмаштырылган жок.",
    categoryLabels: {
      evo_service_fee: "EVO кызматы",
      third_party_cost: "Үчүнчү тарап чыгымы",
    },
  },
  en: {
    title: "Case operations",
    description:
      "Applications, visa and finance controls share one Supabase case authority.",
    applications: "University applications",
    visa: "Visa",
    finance: "Finance control",
    history: "Change history",
    createApplication: "Add application",
    institution: "Institution",
    program: "Program",
    status: "Status",
    evidence: "Evidence reference",
    note: "Note",
    save: "Save",
    saving: "Saving…",
    emptyApplications: "No applications yet.",
    visaMissing: "A visa case has not been created yet.",
    visaEvidence: "Visa change evidence",
    obligations: "Obligations",
    noObligations: "No finance obligations yet.",
    outstanding: "Outstanding",
    due: "Due",
    nextAction: "Next action",
    addObligation: "Add obligation",
    label: "Label",
    category: "Category",
    amount: "Amount",
    currency: "Currency",
    dueDate: "Due date",
    reason: "Reason",
    confirmPayment: "Confirm full payment",
    paymentEvidence: "Payment evidence",
    assertStop: "Assert finance stop",
    blockedAction: "Blocked action",
    stopEvidence: "Stop evidence",
    activeStops: "Active stops",
    releaseStop: "Release stop (Admin only)",
    noHistory: "No history yet.",
    closed: "Case is closed: changes are unavailable.",
    saved: "Change saved.",
    invalid: "Change rejected: check every field.",
    unavailable: "Supabase did not confirm the change. No fallback data was used.",
    categoryLabels: {
      evo_service_fee: "EVO service fee",
      third_party_cost: "Third-party cost",
    },
  },
} as const;

const STATUS_LABELS: Record<string, Record<Locale, string>> = {
  preparation: { ru: "Подготовка", ky: "Даярдоо", en: "Preparation" },
  ready: { ru: "Готова", ky: "Даяр", en: "Ready" },
  submitted: { ru: "Подана", ky: "Тапшырылды", en: "Submitted" },
  under_review: { ru: "На рассмотрении", ky: "Каралууда", en: "Under review" },
  offer: { ru: "Оффер", ky: "Оффер", en: "Offer" },
  rejected: { ru: "Отказ", ky: "Баш тартылды", en: "Rejected" },
  enrolled: { ru: "Зачислен", ky: "Кабыл алынды", en: "Enrolled" },
  withdrawn: { ru: "Отозвана", ky: "Кайтарылды", en: "Withdrawn" },
  closed: { ru: "Закрыта", ky: "Жабык", en: "Closed" },
  not_required: { ru: "Не требуется", ky: "Талап кылынбайт", en: "Not required" },
  not_started: { ru: "Не начата", ky: "Баштала элек", en: "Not started" },
  docs: { ru: "Документы", ky: "Документтер", en: "Documents" },
  appointment: { ru: "Запись", ky: "Жазылуу", en: "Appointment" },
  approved: { ru: "Одобрена", ky: "Жактырылды", en: "Approved" },
  pending: { ru: "Ожидается", ky: "Күтүлүүдө", en: "Pending" },
  partially_paid: { ru: "Частично оплачено", ky: "Жарым-жартылай төлөндү", en: "Partially paid" },
  paid: { ru: "Оплачено", ky: "Төлөндү", en: "Paid" },
  overdue: { ru: "Просрочено", ky: "Мөөнөтү өттү", en: "Overdue" },
};

const BLOCKED_ACTION_LABELS = {
  application_submission: { ru: "Подача заявки", ky: "Арыз тапшыруу", en: "Application submission" },
  document_processing: { ru: "Работа с документами", ky: "Документ иштетүү", en: "Document processing" },
  visa_submission: { ru: "Подача на визу", ky: "Визага тапшыруу", en: "Visa submission" },
  case_progression: { ru: "Движение кейса", ky: "Кейсти жылдыруу", en: "Case progression" },
} as const;

function statusLabel(status: string, locale: Locale): string {
  return STATUS_LABELS[status]?.[locale] ?? status;
}

function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(
    locale === "ru" ? "ru-RU" : locale === "ky" ? "ky-KG" : "en-US",
    { dateStyle: "medium" },
  ).format(new Date(value));
}

function formatMoney(amountMinor: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(
    locale === "ru" ? "ru-RU" : locale === "ky" ? "ky-KG" : "en-US",
    { style: "currency", currency },
  ).format(amountMinor / 100);
}

function SubmitButton({ label, pending }: Readonly<{ label: string; pending: string }>) {
  const state = useFormStatus();
  return (
    <button type="submit" className={btnCls} disabled={state.pending}>
      {state.pending ? pending : label}
    </button>
  );
}

function Feedback({ outcome, locale }: Readonly<{ outcome?: MutationOutcome; locale: Locale }>) {
  if (!outcome) return null;
  const copy = COPY[locale];
  return (
    <p
      role="status"
      className={cn(
        "border-l-2 px-3 py-2 text-sm",
        outcome === "saved"
          ? "border-ok bg-ok-weak text-ok"
          : outcome === "invalid"
            ? "border-warn bg-warn-weak text-warn"
            : "border-danger bg-danger-weak text-danger",
      )}
    >
      {copy[outcome]}
    </p>
  );
}

export function PlatformAdmissionsOperationsPanel({
  locale,
  studentCaseId,
  studentCaseState,
  authorityRole,
  presentationRole,
  applications,
  visa,
  finance,
  requestIds,
  feedback,
}: Props) {
  const copy = COPY[locale];
  const canWriteAdmissions =
    studentCaseState === "active" &&
    (presentationRole === "admin" || presentationRole === "admissions");
  const adminView = studentCaseState === "active" && presentationRole === "admin";
  const canAssertStop = canWriteAdmissions;

  return (
    <section
      id="case-operations"
      data-testid="platform-admissions-operations"
      data-authority-role={authorityRole}
      data-presentation-role={presentationRole}
      className="space-y-8 border-y border-border py-6"
      aria-labelledby="platform-admissions-operations-title"
    >
      <header>
        <h2 id="platform-admissions-operations-title" className="text-xl font-semibold text-fg">
          {copy.title}
        </h2>
        <p className="mt-1 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
        {studentCaseState === "closed" ? (
          <p className="mt-3 border-l-2 border-warn px-3 py-2 text-sm text-warn">
            {copy.closed}
          </p>
        ) : null}
      </header>
      <Feedback outcome={feedback?.caseOperations?.outcome} locale={locale} />

      <section id="applications" data-testid="platform-university-applications" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <h3 className="text-base font-semibold text-fg">{copy.applications}</h3>
          <span className="text-xs tabular-nums text-fg-3">{applications.length}</span>
        </div>
        <Feedback outcome={feedback?.applications?.outcome} locale={locale} />
        {applications.length === 0 ? (
          <p className="py-3 text-sm text-fg-3">{copy.emptyApplications}</p>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {applications.map((application) => (
              <article key={application.universityApplicationId} className="py-4" data-application-id={application.universityApplicationId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-fg">{application.institutionName}</p>
                    <p className="mt-1 text-sm text-fg-3">{application.programName}</p>
                  </div>
                  <Badge value={application.status} label={statusLabel(application.status, locale)} />
                </div>
                {application.latestEvidenceReference ? (
                  <p className="mt-2 break-all text-xs text-fg-3">{application.latestEvidenceReference}</p>
                ) : null}
                {canWriteAdmissions ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-accent">{copy.save}</summary>
                    <form action={changePlatformUniversityApplicationAction} className="mt-3 grid gap-3 md:grid-cols-2">
                      <input type="hidden" name="application_id" value={application.universityApplicationId} />
                      <input type="hidden" name="student_case_id" value={studentCaseId} />
                      <input type="hidden" name="return_to_case" value="1" />
                      <input type="hidden" name="request_id" value={requestIds.applications[application.universityApplicationId]} />
                      <label>
                        <span className={labelCls}>{copy.status}</span>
                        <select name="status" defaultValue={application.status} className={inputCls}>
                          {PLATFORM_APPLICATION_STATUSES.map((status) => (
                            <option key={status} value={status}>{statusLabel(status, locale)}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className={labelCls}>{copy.evidence}</span>
                        <input name="evidence_reference" defaultValue={application.latestEvidenceReference ?? ""} maxLength={1000} className={inputCls} />
                      </label>
                      <label className="md:col-span-2">
                        <span className={labelCls}>{copy.note}</span>
                        <textarea name="note" maxLength={1000} className={inputCls} rows={2} />
                      </label>
                      <div className="md:col-span-2"><SubmitButton label={copy.save} pending={copy.saving} /></div>
                    </form>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {canWriteAdmissions ? (
          <details>
            <summary className={cn(btnGhostCls, "inline-flex cursor-pointer list-none")}>{copy.createApplication}</summary>
            <form action={createPlatformUniversityApplicationAction} className="mt-4 grid gap-3 border-l-2 border-accent pl-4 md:grid-cols-2">
              <input type="hidden" name="student_case_id" value={studentCaseId} />
              <input type="hidden" name="catalog_institution_id" value="" />
              <input type="hidden" name="return_to_case" value="1" />
              <input type="hidden" name="request_id" value={requestIds.createApplication} />
              <label>
                <span className={labelCls}>{copy.institution}</span>
                <input name="institution_name" required maxLength={300} className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>{copy.program}</span>
                <input name="program_name" required maxLength={300} className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>{copy.status}</span>
                <select name="status" defaultValue="preparation" className={inputCls}>
                  {PLATFORM_APPLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>{statusLabel(status, locale)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelCls}>{copy.evidence}</span>
                <input name="evidence_reference" maxLength={1000} className={inputCls} />
              </label>
              <label className="md:col-span-2">
                <span className={labelCls}>{copy.note}</span>
                <textarea name="note" maxLength={1000} className={inputCls} rows={2} />
              </label>
              <div className="md:col-span-2"><SubmitButton label={copy.createApplication} pending={copy.saving} /></div>
            </form>
          </details>
        ) : null}
      </section>

      <section id="visa" data-testid="platform-case-visa" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <h3 className="text-base font-semibold text-fg">{copy.visa}</h3>
          {visa ? <Badge value={visa.status} label={statusLabel(visa.status, locale)} /> : null}
        </div>
        {!visa ? <p className="text-sm text-fg-3">{copy.visaMissing}</p> : null}
        {canWriteAdmissions ? (
          <form action={upsertPlatformCaseVisaAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="student_case_id" value={studentCaseId} />
            <input type="hidden" name="visa_case_id" value={visa?.visaCaseId ?? ""} />
            <input type="hidden" name="request_id" value={requestIds.visa} />
            <label>
              <span className={labelCls}>{copy.status}</span>
              <select name="status" defaultValue={visa?.status ?? "not_started"} className={inputCls}>
                {PLATFORM_VISA_STATUSES.map((status) => (
                  <option key={status} value={status}>{statusLabel(status, locale)}</option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>{copy.visaEvidence}</span>
              <input name="evidence_reference" required maxLength={2000} className={inputCls} />
            </label>
            <label className="md:col-span-2">
              <span className={labelCls}>{copy.note}</span>
              <textarea name="note" defaultValue={visa?.note ?? ""} maxLength={4000} className={inputCls} rows={2} />
            </label>
            <div className="md:col-span-2"><SubmitButton label={copy.save} pending={copy.saving} /></div>
          </form>
        ) : null}
      </section>

      <section id="finance" data-testid="platform-case-finance-control" className="scroll-mt-24 space-y-4">
        <span id="payments" className="block scroll-mt-24" />
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <h3 className="text-base font-semibold text-fg">{copy.finance}</h3>
          <span className="text-xs tabular-nums text-fg-3">{finance.obligations.length}</span>
        </div>
        <Feedback outcome={feedback?.financeStops?.outcome} locale={locale} />

        <div>
          <h4 className="text-sm font-semibold text-fg">{copy.obligations}</h4>
          {finance.obligations.length === 0 ? (
            <p className="mt-3 text-sm text-fg-3">{copy.noObligations}</p>
          ) : (
            <div className="mt-3 divide-y divide-border border-y border-border">
              {finance.obligations.map((obligation) => (
                <article key={obligation.paymentObligationId} className="space-y-3 py-4" data-obligation-id={obligation.paymentObligationId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-fg">{obligation.label}</p>
                      <p className="mt-1 text-sm text-fg-3">
                        {copy.outstanding}: {formatMoney(obligation.outstandingMinor, obligation.currency, locale)} · {copy.due}: {formatDate(obligation.dueAt, locale)}
                      </p>
                      <p className="mt-1 text-sm text-fg-3">{copy.nextAction}: {obligation.nextAction}</p>
                    </div>
                    <Badge value={obligation.status} label={statusLabel(obligation.status, locale)} />
                  </div>

                  {obligation.activeStopFactors.length > 0 ? (
                    <div className="space-y-2 border-l-2 border-danger pl-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-danger">{copy.activeStops}</p>
                      {obligation.activeStopFactors.map((stop) => (
                        <div key={stop.stopFactorId} className="text-sm text-fg-2">
                          <p>{stop.reason}</p>
                          <p className="mt-1 text-xs text-fg-3">{stop.blockedAction} · {stop.nextAction} · {stop.ownerDisplayName}</p>
                          {adminView ? (
                            <form action={resolvePlatformFinanceStopFactorAction} className="mt-2 grid gap-2 md:grid-cols-2">
                              <input type="hidden" name="student_case_id" value={studentCaseId} />
                              <input type="hidden" name="stop_factor_id" value={stop.stopFactorId} />
                              <input type="hidden" name="request_id" value={requestIds.resolveStops[stop.stopFactorId]} />
                              <input name="reason" required minLength={3} maxLength={1000} className={inputCls} placeholder={copy.reason} />
                              <input name="evidence_ref" required maxLength={512} className={inputCls} placeholder={copy.evidence} />
                              <div className="md:col-span-2"><SubmitButton label={copy.releaseStop} pending={copy.saving} /></div>
                            </form>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {adminView && obligation.status !== "paid" ? (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-accent">{copy.confirmPayment}</summary>
                      <form action={settlePlatformPaymentObligationAction} className="mt-3 grid gap-2 md:grid-cols-2">
                        <input type="hidden" name="student_case_id" value={studentCaseId} />
                        <input type="hidden" name="payment_obligation_id" value={obligation.paymentObligationId} />
                        <input type="hidden" name="request_id" value={requestIds.settlePayments[obligation.paymentObligationId]} />
                        <input name="evidence_ref" required maxLength={2000} className={inputCls} placeholder={copy.paymentEvidence} />
                        <input name="reason" required minLength={3} maxLength={1000} className={inputCls} placeholder={copy.reason} />
                        <div className="md:col-span-2"><SubmitButton label={copy.confirmPayment} pending={copy.saving} /></div>
                      </form>
                    </details>
                  ) : null}

                  {canAssertStop && obligation.status !== "paid" ? (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-danger">{copy.assertStop}</summary>
                      <form action={createPlatformFinanceStopFactorAction} className="mt-3 grid gap-2 md:grid-cols-2">
                        <input type="hidden" name="student_case_id" value={studentCaseId} />
                        <input type="hidden" name="payment_obligation_id" value={obligation.paymentObligationId} />
                        <input type="hidden" name="request_id" value={requestIds.createStops[obligation.paymentObligationId]} />
                        <label>
                          <span className={labelCls}>{copy.blockedAction}</span>
                          <select name="blocked_action" defaultValue="case_progression" className={inputCls}>
                            {Object.entries(BLOCKED_ACTION_LABELS).map(([value, labels]) => (
                              <option key={value} value={value}>{labels[locale]}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className={labelCls}>{copy.reason}</span>
                          <input name="reason" required minLength={3} maxLength={1000} className={inputCls} />
                        </label>
                        <label>
                          <span className={labelCls}>{copy.nextAction}</span>
                          <input name="next_action" required minLength={3} maxLength={1000} className={inputCls} />
                        </label>
                        <label>
                          <span className={labelCls}>{copy.stopEvidence}</span>
                          <input name="evidence_ref" required maxLength={512} className={inputCls} />
                        </label>
                        <div className="md:col-span-2"><SubmitButton label={copy.assertStop} pending={copy.saving} /></div>
                      </form>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        {adminView ? (
          <details>
            <summary className={cn(btnGhostCls, "inline-flex cursor-pointer list-none")}>{copy.addObligation}</summary>
            <form action={createPlatformPaymentObligationAction} className="mt-4 grid gap-3 border-l-2 border-accent pl-4 md:grid-cols-2">
              <input type="hidden" name="student_case_id" value={studentCaseId} />
              <input type="hidden" name="request_id" value={requestIds.createPayment} />
              <label>
                <span className={labelCls}>{copy.label}</span>
                <input name="label" required maxLength={500} className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>{copy.category}</span>
                <select name="category" defaultValue="evo_service_fee" className={inputCls}>
                  {PLATFORM_OBLIGATION_CATEGORIES.map((category) => (
                    <option key={category} value={category}>{copy.categoryLabels[category]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelCls}>{copy.amount}</span>
                <input name="amount" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>{copy.currency}</span>
                <select name="currency" defaultValue="USD" className={inputCls}>
                  <option value="KGS">KGS</option><option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </label>
              <label>
                <span className={labelCls}>{copy.dueDate}</span>
                <input type="date" name="due_date" required className={inputCls} />
              </label>
              <label>
                <span className={labelCls}>{copy.nextAction}</span>
                <input name="next_action" required maxLength={1000} className={inputCls} />
              </label>
              <label className="md:col-span-2">
                <span className={labelCls}>{copy.reason}</span>
                <input name="reason" required minLength={3} maxLength={1000} className={inputCls} />
              </label>
              <div className="md:col-span-2"><SubmitButton label={copy.addObligation} pending={copy.saving} /></div>
            </form>
          </details>
        ) : null}

        <div>
          <h4 className="border-b border-border pb-2 text-sm font-semibold text-fg">{copy.history}</h4>
          {finance.history.length === 0 ? (
            <p className="py-3 text-sm text-fg-3">{copy.noHistory}</p>
          ) : (
            <ol className="divide-y divide-border">
              {finance.history.map((entry) => (
                <li key={entry.auditEventId} className="py-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-fg">{entry.action}</span>
                    <time className="text-xs text-fg-3">{formatDate(entry.createdAt, locale)}</time>
                  </div>
                  <p className="mt-1 text-fg-3">{entry.actorDisplayName ?? "—"}{entry.reason ? ` · ${entry.reason}` : ""}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </section>
  );
}
