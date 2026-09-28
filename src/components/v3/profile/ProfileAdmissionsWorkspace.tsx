"use client";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";
import { btnGhostCls, Card, cn, inputCls, fieldLabelCls } from "@/components/ui";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import {
  changePlatformUniversityApplicationAction,
  updateApplicationPartnerDetailsAction,
  updatePlatformUniversityApplicationDetailsAction,
  type PlatformUniversityApplicationActionState,
} from "@/lib/platform-admissions-actions";
import {
  PLATFORM_APPLICATION_EVIDENCE_STATUSES,
  PLATFORM_APPLICATION_FORWARD_STATUSES,
  platformApplicationCountryEditOptions,
  platformApplicationDegreeEditOptions,
  type PlatformApplicationQueueRow,
} from "@/lib/platform-application-contract";
import {
  createPlatformFinanceStopFactorAction,
  resolvePlatformFinanceStopFactorAction,
  type PlatformFinanceStopFactorActionState,
} from "@/lib/platform-case-operations-actions";
import {
  APPLICATION_PATH_STEPS,
  applicationStatus,
  country as applicationCountry,
  degree as applicationDegree,
  financeBlockedAction,
  financeBlockedActionOptions,
} from "@/lib/v3/wording";

import { DueWord } from "../blocks/DueWord";
import { StatusChip } from "../blocks/StatusChip";
import { useAnchoredPopover } from "../queue/useAnchoredPopover";
import { StaffPreparationPanel } from "./StaffPreparationPanel";
import type { CatalogPreparation } from "@/lib/portal/catalog-preparations";
import type { StaffPreparationRead } from "@/lib/v3/staff-catalog-preparation-actions";
import type { ApplicationPartnerDetails, ProfileAdmissionsWorkspace } from "./types";
import { partnerPacketHref, universityRows, type UniversityRow } from "./university-programs-view";

export type ActionStatus =
  | PlatformUniversityApplicationActionState["status"]
  | PlatformFinanceStopFactorActionState["status"];

const STATUS_COPY: Record<Exclude<ActionStatus, "idle">, string> = {
  saved: "Изменение сохранено.",
  invalid: "Проверьте обязательные поля и формат значений.",
  forbidden: "У вашей роли нет права выполнить это действие.",
  stale: "Данные уже изменились. Показано актуальное состояние — проверьте его перед повтором.",
  request_conflict: "Этот запрос уже использован с другими данными. Повторите действие с новым идентификатором запроса.",
  unavailable: "Supabase не подтвердил изменение. Ничего не отмечено как сохранённое.",
};

/** Exported for ApplicationCreateDialog.tsx, which reuses this same locked/refresh convention. */
export function useCanonicalRefresh(status: ActionStatus): void {
  const router = useRouter();
  useEffect(() => {
    if (status === "saved" || status === "stale") router.refresh();
  }, [router, status]);
}

/** Exported for ApplicationCreateDialog.tsx (reuse, not a second copy). */
export function PrimaryApplicationField({
  defaultChecked,
}: Readonly<{ defaultChecked: boolean }>) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-ctl px-2 py-2 text-sm leading-5 text-fg-2 hover:bg-surface-2">
      <input
        type="checkbox"
        name="is_primary"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
      />
      <span>
        <span className="block font-medium text-fg">Основной вариант</span>
        <span className="block text-xs text-fg-3">
          В деле может быть только один; выбор заменит текущий основной вариант.
        </span>
      </span>
    </label>
  );
}

/** Exported for ApplicationCreateDialog.tsx (reuse, not a second copy). */
export function ApplicationCountryField({
  defaultValue = "",
}: Readonly<{ defaultValue?: string }>) {
  const options = platformApplicationCountryEditOptions(defaultValue || null);
  return (
    <label>
      <span className={fieldLabelCls}>Страна</span>
      <select name="country" defaultValue={defaultValue} className={inputCls}>
        <option value="">Не указана</option>
        {options.map((countryCode) => (
          <option key={countryCode} value={countryCode}>
            {applicationCountry(countryCode) ?? "Сохранено ранее (оставить без изменений)"}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Exported for ApplicationCreateDialog.tsx (reuse, not a second copy). */
export function ApplicationDegreeField({
  defaultValue = "",
}: Readonly<{ defaultValue?: string }>) {
  const options = platformApplicationDegreeEditOptions(defaultValue || null);
  return (
    <label>
      <span className={fieldLabelCls}>Ступень</span>
      <select name="degree" defaultValue={defaultValue} className={inputCls}>
        <option value="">Не указана</option>
        {options.map((degreeKey) => (
          <option key={degreeKey} value={degreeKey}>
            {applicationDegree(degreeKey) ?? "Сохранено ранее (оставить без изменений)"}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Exported for ApplicationCreateDialog.tsx (reuse, not a second copy). */
export function StateBanner({ status }: Readonly<{ status: ActionStatus }>) {
  if (status === "idle") return null;
  const warning = status === "invalid" || status === "stale" || status === "request_conflict";
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "text-xs leading-5",
        status === "saved" ? "text-ok" : warning ? "text-warn" : "text-danger",
      )}
      data-testid="v3-admissions-action-status"
      data-status={status}
    >
      {STATUS_COPY[status]}
    </p>
  );
}

/**
 * OTH-4 («Отметить статус»): un-deadens `platform.change_university_application`
 * (live since 107, previously exported but never rendered anywhere — see this
 * slice's plan doc, «Uni & knowledge base», «Добавленный вуз означает
 * «рассматриваем». Фактическая подача отмечается отдельно»). Only the
 * meaningful forward statuses are offered (PLATFORM_APPLICATION_FORWARD_STATUSES
 * excludes `preparation`, the fixed create-time default). Evidence is always
 * submitted as one field (exactActionStringFields requires the exact expected
 * count every time, the same convention `is_primary`'s checkbox already
 * relies on above) but only rendered/required while the chosen status needs
 * it; `rejected`/`withdrawn` require a note the same way the RPC itself does.
 */
function ApplicationStatusForm({
  workspace,
  application,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  application: PlatformApplicationQueueRow;
}>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.changeStatus[application.universityApplicationId],
    universityApplicationId: application.universityApplicationId,
    version: application.version,
  };
  const [state, action, pending] = useActionState(
    changePlatformUniversityApplicationAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";
  const [nextStatus, setNextStatus] = useState("");
  const needsEvidence = PLATFORM_APPLICATION_EVIDENCE_STATUSES.has(
    nextStatus as (typeof PLATFORM_APPLICATION_FORWARD_STATUSES)[number],
  );
  const needsNote = nextStatus === "rejected" || nextStatus === "withdrawn";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="application_id" value={application.universityApplicationId} />
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? application.version} />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={fieldLabelCls}>Статус</span>
          <select
            name="status"
            required
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value)}
            className={inputCls}
          >
            <option value="">Выберите статус</option>
            {PLATFORM_APPLICATION_FORWARD_STATUSES.filter((status) => status !== application.status).map((status) => (
              <option key={status} value={status}>{applicationStatus(status)}</option>
            ))}
          </select>
        </label>
        {needsEvidence ? (
          <label>
            <span className={fieldLabelCls}>Ссылка на подтверждение</span>
            <input name="evidence_reference" required maxLength={1000} className={inputCls} />
          </label>
        ) : (
          <input type="hidden" name="evidence_reference" value="" />
        )}
        <label className="md:col-span-2">
          <span className={fieldLabelCls}>Заметка</span>
          <textarea name="note" required={needsNote} rows={2} maxLength={1000} className={inputCls} />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked || !nextStatus}>
          {pending ? "Сохраняем…" : "Сохранить статус"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

function ApplicationDetailsForm({
  workspace,
  application,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  application: PlatformApplicationQueueRow;
}>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.applicationDetails[application.universityApplicationId],
    universityApplicationId: application.universityApplicationId,
    version: application.version,
  };
  const [state, action, pending] = useActionState(
    updatePlatformUniversityApplicationDetailsAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="application_id" value={application.universityApplicationId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? application.version} />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <PrimaryApplicationField defaultChecked={application.isPrimary} />
        <label>
          <span className={fieldLabelCls}>Дедлайн от университета</span>
          <input
            name="university_deadline_on"
            type="date"
            defaultValue={application.universityDeadlineOn ?? ""}
            className={inputCls}
          />
        </label>
        <ApplicationCountryField defaultValue={application.country ?? ""} />
        <ApplicationDegreeField defaultValue={application.degree ?? ""} />
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Сохранить детали"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

/**
 * Партнёр и решение — editable since unified workflow S7 (plan §8/§11).
 * `platform.update_application_partner_details_v1` (migration 184) needs no
 * admissions_playbook_version_id, unlike the retired 137 write path — see
 * `readApplicationPartnerDetails` in `src/lib/v3/admissions-source.ts` for
 * the full history. Э8.2: форму открывает «⋯ → Партнёр и решение» строки
 * вуза (право `application.manage`); сохранённые сведения стоят в самой
 * строке для всех, кто видит вкладку, — отдельной карточки только для
 * чтения больше нет.
 */
function ApplicationPartnerFacts({
  workspace, application, details,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  application: PlatformApplicationQueueRow;
  details: ApplicationPartnerDetails | undefined;
}>) {
  const initialState: PlatformUniversityApplicationActionState = {
    status: "idle",
    requestId: workspace.requestIds.partnerDetails[application.universityApplicationId],
    universityApplicationId: application.universityApplicationId,
    version: details?.version ?? application.version,
  };
  const [state, action, pending] = useActionState(
    updateApplicationPartnerDetailsAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";
  const [draft, setDraft] = useState({
    partnerContact: details?.partnerContact ?? "",
    externalLink: details?.externalLink ?? "",
    decisionReference: details?.decisionReference ?? "",
    decisionNote: details?.decisionNote ?? "",
  });

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="application_id" value={application.universityApplicationId} />
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? application.version} />
      <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={fieldLabelCls}>Контакт партнёра</span>
          <input
            name="partner_contact"
            maxLength={300}
            value={draft.partnerContact}
            onChange={(event) => setDraft((previous) => ({ ...previous, partnerContact: event.target.value }))}
            className={inputCls}
          />
        </label>
        <label>
          <span className={fieldLabelCls}>Ссылка</span>
          <input
            name="external_link"
            type="url"
            maxLength={2000}
            placeholder="https://…"
            value={draft.externalLink}
            onChange={(event) => setDraft((previous) => ({ ...previous, externalLink: event.target.value }))}
            className={inputCls}
          />
        </label>
        <label>
          <span className={fieldLabelCls}>Номер / ссылка решения</span>
          <input
            name="decision_reference"
            maxLength={300}
            value={draft.decisionReference}
            onChange={(event) => setDraft((previous) => ({ ...previous, decisionReference: event.target.value }))}
            className={inputCls}
          />
        </label>
        <label className="sm:col-span-2">
          <span className={fieldLabelCls}>Заметка о решении</span>
          <textarea
            name="decision_note"
            maxLength={2000}
            rows={2}
            value={draft.decisionNote}
            onChange={(event) => setDraft((previous) => ({ ...previous, decisionNote: event.target.value }))}
            className={inputCls}
          />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

function FinanceStopCreateForm({
  workspace,
  obligationId,
}: Readonly<{ workspace: ProfileAdmissionsWorkspace; obligationId: string }>) {
  const initialState: PlatformFinanceStopFactorActionState = {
    status: "idle",
    requestId: workspace.requestIds.createStops[obligationId],
    stopFactorId: null,
    version: null,
  };
  const [state, action, pending] = useActionState(
    createPlatformFinanceStopFactorAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-3 space-y-3" aria-busy={pending}>
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="payment_obligation_id" value={obligationId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value="0" />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={fieldLabelCls}>Что блокируем</span>
          <select
            name="blocked_action"
            required
            defaultValue="application_submission"
            className={inputCls}
          >
            {financeBlockedActionOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={fieldLabelCls}>Следующий шаг</span>
          <input name="next_action" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={fieldLabelCls}>Причина</span>
          <input name="reason" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={fieldLabelCls}>Ссылка на подтверждение</span>
          <input name="evidence_ref" required maxLength={512} className={inputCls} />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Поставить стоп"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

function FinanceStopResolveForm({
  workspace,
  stopFactorId,
  version,
}: Readonly<{
  workspace: ProfileAdmissionsWorkspace;
  stopFactorId: string;
  version: string;
}>) {
  const initialState: PlatformFinanceStopFactorActionState = {
    status: "idle",
    requestId: workspace.requestIds.resolveStops[stopFactorId],
    stopFactorId,
    version,
  };
  const [state, action, pending] = useActionState(
    resolvePlatformFinanceStopFactorAction,
    initialState,
  );
  useCanonicalRefresh(state.status);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form action={action} className="mt-2 space-y-3" aria-busy={pending}>
      <input type="hidden" name="student_case_id" value={workspace.studentCaseId} />
      <input type="hidden" name="stop_factor_id" value={stopFactorId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="expected_version" value={state.version ?? version} />
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
        <label>
          <span className={fieldLabelCls}>Причина снятия</span>
          <input name="reason" required minLength={3} maxLength={1000} className={inputCls} />
        </label>
        <label>
          <span className={fieldLabelCls}>Ссылка на подтверждение</span>
          <input name="evidence_ref" required maxLength={512} className={inputCls} />
        </label>
        <button type="submit" className={btnGhostCls} disabled={locked}>
          {pending ? "Сохраняем…" : "Снять стоп"}
        </button>
      </fieldset>
      <StateBanner status={state.status} />
    </form>
  );
}

type RowPanel = "details" | "status" | "partner";
const ROW_PANEL_TITLES: Readonly<Record<RowPanel, string>> = {
  details: "Параметры заявки",
  status: "Отметить статус",
  partner: "Партнёр и решение",
};
/** Пункт «⋯» строки — как у «⋯» EVO Docs (`DocsRowMenu`). */
const MENU_ITEM = "flex min-h-11 w-full items-center rounded-nav px-3 text-start t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/** Внешняя ссылка партнёра становится ссылкой только по http(s); остальное — текстом. */
function webLink(value: string | null | undefined): string | null {
  return value && /^https?:\/\//iu.test(value) ? value : null;
}

/**
 * Путь «вариант → заявка подана → решение» (Э8.2): пройденные шаги — тихим
 * текстом, текущий — одним словом `StatusChip` (слово статуса), следующие —
 * самым тихим. Заявка, сошедшая с пути (отозвана, закрыта), — только слово.
 */
function UniversityPath({ row }: Readonly<{ row: UniversityRow }>) {
  const chip = row.word ? <StatusChip label={row.word} tone={row.tone} /> : null;
  if (row.step === null) return <p className="t-meta">{chip}</p>;
  return (
    <ol aria-label="Путь заявки" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 t-meta" data-step={row.step}>
      {APPLICATION_PATH_STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-1.5" aria-current={index === row.step ? "step" : undefined}>
          {index > 0 ? <span aria-hidden="true" className="text-fg-3">→</span> : null}
          {index === row.step ? chip : <span className={index < row.step! ? "text-fg-2" : "text-fg-3"}>{label}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Строка вуза (Э8.2): вуз · программа · набор, путь заявки, срок подачи и
 * кто добавил; справа «⋯» — «Параметры заявки», «Отметить статус»,
 * «Партнёр и решение» (право `application.manage` в активном деле) и
 * «Пакет партнёру» (панель пакетов этой вкладки с выбранной заявкой).
 * Формы — прежние команды; открытая форма стоит под строкой, одна за раз
 * (скрытые остаются в разметке — введённое не теряется). Подготовка
 * документов программы из каталога — раскрытием «Документы программы».
 */
function UniversityRowItem({
  row,
  workspace,
  details,
  canWrite,
  packetsHref,
  preparation,
}: Readonly<{
  row: UniversityRow;
  workspace: ProfileAdmissionsWorkspace;
  details: ApplicationPartnerDetails | undefined;
  canWrite: boolean;
  packetsHref: string | null;
  preparation: ReactNode;
}>) {
  const [panel, setPanel] = useState<RowPanel | null>(null);
  const menu = useAnchoredPopover("end");
  const panelId = useId();
  const application = row.application;
  const writable = canWrite && application !== null;
  const packet = packetsHref && application ? partnerPacketHref(packetsHref, application.universityApplicationId) : null;
  const closeMenu = () => document.getElementById(menu.popoverId)?.hidePopover();
  const openPanel = (next: RowPanel) => {
    closeMenu();
    setPanel(next);
    // Фокус — на заголовок открытой формы: читалка называет, что открылось.
    requestAnimationFrame(() => document.getElementById(`${panelId}-${next}`)?.focus());
  };
  const closePanel = () => {
    setPanel(null);
    requestAnimationFrame(() => document.getElementById(menu.triggerId)?.focus());
  };
  const partnerLink = webLink(details?.externalLink);
  const partner = [
    details?.partnerContact ? `Партнёр: ${details.partnerContact}` : null,
    details?.externalLink && !partnerLink ? `Ссылка: ${details.externalLink}` : null,
    details?.decisionReference ? `Решение: ${details.decisionReference}` : null,
    details?.decisionNote ?? null,
  ].filter((part): part is string => part !== null);
  const meta = [...row.facts, row.addedBy ? `Добавил: ${row.addedBy}` : null].filter((part): part is string => part !== null);

  const panels = writable && application ? (
    [
      ["details", <ApplicationDetailsForm
        key={`details-${application.universityApplicationId}-${application.version}`}
        workspace={workspace}
        application={application}
      />],
      ["status", <ApplicationStatusForm
        key={`status-${application.universityApplicationId}-${application.version}`}
        workspace={workspace}
        application={application}
      />],
      ["partner", <ApplicationPartnerFacts
        key={`partner-${application.universityApplicationId}-${details?.version ?? application.version}`}
        workspace={workspace}
        application={application}
        details={details}
      />],
    ] as const
  ) : [];

  return (
    <li
      className="py-3"
      data-testid="v3-profile-application"
      data-application-id={row.applicationId}
      data-primary={row.primary ? "true" : "false"}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 [grid-template-areas:'main_menu'_'path_path'] @min-[48rem]/unis:grid-cols-[minmax(0,1fr)_minmax(0,20rem)_auto] @min-[48rem]/unis:[grid-template-areas:'main_path_menu']">
        <div className="min-w-0 [grid-area:main]">
          <p className="break-words t-item text-fg">
            {row.university}
            {row.primary ? <span className="ms-2 whitespace-nowrap t-meta text-fg-2"><span aria-hidden="true">★ </span>основной</span> : null}
          </p>
          <p className="mt-0.5 break-words t-body-compact text-fg-2">
            {row.program ?? "Программа не указана"}{row.intake ? ` · ${row.intake}` : ""}
          </p>
          {meta.length ? <p className="mt-0.5 break-words t-meta text-fg-2">{meta.join(" · ")}</p> : null}
          {application?.latestEvidenceReference ? (
            <p className="mt-0.5 break-words t-meta text-fg-2">Подтверждение: {application.latestEvidenceReference}</p>
          ) : null}
          {partner.length ? <p className="mt-0.5 break-words t-meta text-fg-2">{partner.join(" · ")}</p> : null}
          {partnerLink ? (
            <a href={partnerLink} target="_blank" rel="noopener noreferrer" className="-my-1.5 inline-flex min-h-11 items-center t-meta text-accent-text underline underline-offset-4">
              Ссылка партнёра (откроется в новой вкладке)
            </a>
          ) : null}
        </div>
        <div className="min-w-0 space-y-1 [grid-area:path] @min-[48rem]/unis:pt-0.5">
          <UniversityPath row={row} />
          {row.deadline ? (
            <p className="t-meta text-fg-2">
              Срок подачи{" "}
              <time dateTime={row.deadline.dateTime} className="font-mono tabular-nums text-fg">{row.deadline.text}</time>
              {row.deadline.word ? <> <DueWord view={row.deadline.word} /></> : null}
              {row.deadline.unconfirmed ? " · нужно подтвердить" : null}
            </p>
          ) : null}
        </div>
        {/* Колонка «⋯» — 44 px у каждой строки: путь и срок стоят на одной линии и там, где «⋯» нет. */}
        <div className="-me-2 -mt-2.5 w-11 [grid-area:menu]">
          {writable || packet ? (
            <>
              <button
                id={menu.triggerId}
                type="button"
                popoverTarget={menu.popoverId}
                style={menu.triggerStyle}
                aria-label={`Ещё: ${row.university}`}
                className="grid size-11 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
              >
                <Icon name="more-horizontal" size={20} />
              </button>
              <div
                id={menu.popoverId}
                popover="auto"
                style={menu.popoverStyle}
                role="group"
                aria-label={`Ещё: ${row.university}`}
                className="v3-anchored v3-anchored-end w-60 rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg"
                data-testid="v3-application-menu"
              >
                {writable ? (Object.keys(ROW_PANEL_TITLES) as RowPanel[]).map((key) => (
                  <button key={key} type="button" className={MENU_ITEM} aria-expanded={panel === key} onClick={() => openPanel(key)}>
                    {ROW_PANEL_TITLES[key]}
                  </button>
                )) : null}
                {packet ? (
                  <Link
                    href={packet}
                    className={MENU_ITEM}
                    onClick={() => {
                      closeMenu();
                      // Панель могли свернуть вручную: адрес с `panel=packets` её не раскроет второй раз.
                      const packets = document.getElementById("partner-packets");
                      if (packets instanceof HTMLDetailsElement) packets.open = true;
                    }}
                  >
                    Пакет партнёру
                  </Link>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
      {preparation}
      {panels.map(([key, form]) => (
        <section
          key={key}
          hidden={panel !== key}
          aria-labelledby={`${panelId}-${key}`}
          className="mt-3 rounded-ctl border border-border p-3"
          data-row-panel={key}
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id={`${panelId}-${key}`} tabIndex={-1} className="t-item text-fg focus:outline-none">{ROW_PANEL_TITLES[key]}</h3>
            <button type="button" onClick={closePanel} className="inline-flex min-h-11 items-center px-2 t-label text-fg-2 underline underline-offset-4 hover:text-fg">
              Скрыть
            </button>
          </div>
          {form}
        </section>
      ))}
    </li>
  );
}

/**
 * «Вузы и программы» дела (Э8.2, решение владельца 28.09.2026): один список
 * вузов дела вместо карточки «Заявки» и отдельного выбора из каталога. Строка
 * — вариант из каталога или добавленный вручную вуз вместе с его заявкой
 * (`universityRows`). Кнопки добавления (`toolbar`) передаёт вкладка; в
 * запасном «Обзоре» профиля их нет. Права — подсказки интерфейса, каждую
 * запись проверяет сервер.
 */
export function ProfileAdmissionsWorkspacePanel({
  actor,
  workspace,
  partnerDetails = [],
  preparations,
  nowIso,
  packetsHref = null,
  toolbar = null,
}: Readonly<{
  actor: ActivePlatformActor;
  workspace: ProfileAdmissionsWorkspace | null;
  /** «Партнёр и решение» facts, keyed by application — editable since unified workflow S7 (plan §8/§11). */
  partnerDetails?: readonly ApplicationPartnerDetails[];
  preparations?: StaffPreparationRead<readonly CatalogPreparation[]>;
  /** Момент чтения страницы: слово срока одно и то же при рендере на сервере и в браузере. */
  nowIso: string;
  /** Адрес вкладки «Вузы и программы» с возвратом — для «Пакета партнёру»; null — пункта нет. */
  packetsHref?: string | null;
  /** «+ Вуз из каталога» и «Добавить вручную» — у заголовка списка. */
  toolbar?: ReactNode;
}>) {
  if (!workspace) return null;
  const canWrite = workspace.caseState === "active" && !isStaffPreview(actor);
  const canWriteApplications = canWrite && staffHasPermission(actor, "application.manage");
  const saved = preparations?.status === "ready" ? preparations.value : [];
  const scope = { organizationId: actor.organizationId, membershipId: actor.membershipId, studentCaseId: workspace.studentCaseId };
  const canReadRequirements = !isStaffPreview(actor) && staffHasPermission(actor, "document.read.full");
  const canInitializeRequirements = canWrite && staffHasPermission(actor, "document.manage");
  const canReviewDocuments = canWrite && staffHasPermission(actor, "document.review");
  const rows = universityRows(workspace.applications, saved, new Date(nowIso));

  return (
    <section
      id="applications"
      aria-labelledby="applications-title"
      className="@container/unis scroll-mt-4"
      data-testid="v3-profile-admissions-workspace"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="applications-title" className="me-auto t-section text-fg">Вузы и программы</h2>
        {toolbar}
      </div>
      {preparations && preparations.status !== "ready" ? (
        <p role="status" className="mt-2 t-body-compact text-fg-2">
          {preparations.status === "forbidden" ? "Нет доступа к сохранённым подготовкам в текущем режиме." : "Не удалось прочитать сохранённые подготовки. Обновите страницу; существующие заявки сохранены."}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-3 border-y border-border py-4 t-body-compact text-fg-2" data-testid="v3-universities-empty">
          {canWriteApplications ? "Вузов пока нет. Добавленный вуз — это вариант, а не подача документов." : "Вузов пока нет."}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {rows.map((row) => (
            <UniversityRowItem
              key={row.applicationId}
              row={row}
              workspace={workspace}
              details={partnerDetails.find((item) => item.applicationId === row.applicationId)}
              canWrite={canWriteApplications}
              packetsHref={packetsHref}
              preparation={row.preparation ? (
                <StaffPreparationPanel
                  key={`${scope.organizationId}:${scope.membershipId}:${row.preparation.applicationId}`}
                  preparation={row.preparation}
                  scope={scope}
                  canRead={canReadRequirements}
                  canReview={canReviewDocuments}
                  canInitialize={canInitializeRequirements && row.preparation.applicationStatus === "preparation"}
                />
              ) : null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Панель «Стопы» вкладки «Договор и оплата» (Э8.3): заголовок — у панели.
 * Активный стоп — строкой с чипом, без боковой полосы; «Поставить
 * финансовый стоп» — тихая кнопка (красный текст — только проблема).
 */
export function ProfileFinanceControls({
  actor,
  workspace,
}: Readonly<{
  actor: ActivePlatformActor;
  workspace: ProfileAdmissionsWorkspace | null;
}>) {
  if (!workspace?.finance) return null;
  const canCreate = workspace.caseState === "active" && !isStaffPreview(actor) && staffHasPermission(actor, "finance.stop.create");
  const canRelease = workspace.caseState === "active" && !isStaffPreview(actor) && staffHasPermission(actor, "finance.stop.manage");

  return workspace.finance.obligations.length === 0 ? (
    <p className="py-2 t-body-compact text-fg-2">
      Финансовых обязательств нет — ставить стоп не на что.
    </p>
  ) : (
    <div className="border-t border-border" data-testid="v3-profile-finance-controls">
      {workspace.finance.obligations.map((obligation) => (
        <article key={obligation.paymentObligationId} className="border-b border-border py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="t-item text-fg">{obligation.label}</p>
              {obligation.nextAction ? <p className="t-meta text-fg-2">{obligation.nextAction}</p> : null}
            </div>
            {obligation.activeStopFactors.length > 0 ? (
              <StatusChip label="стоп активен" tone="danger" />
            ) : (
              <StatusChip label="без стопа" />
            )}
          </div>

          {obligation.activeStopFactors.map((stop) => (
            <div key={stop.stopFactorId} className="mt-2 border-t border-border pt-2">
              <p className="t-body-compact text-fg">{stop.reason}</p>
              <p className="t-meta text-fg-2">
                {financeBlockedAction(stop.blockedAction) ?? "—"} · следующий шаг: {stop.nextAction}
              </p>
              {canRelease ? (
                <FinanceStopResolveForm
                  workspace={workspace}
                  stopFactorId={stop.stopFactorId}
                  version={stop.version}
                />
              ) : null}
            </div>
          ))}

          {canCreate && obligation.status !== "paid" ? (
            <details className="mt-1">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden">
                Поставить финансовый стоп
              </summary>
              <FinanceStopCreateForm
                workspace={workspace}
                obligationId={obligation.paymentObligationId}
              />
            </details>
          ) : null}
        </article>
      ))}
    </div>
  );
}
