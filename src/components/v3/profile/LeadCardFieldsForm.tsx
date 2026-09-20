"use client";

import { useRouter } from "next/navigation";
import { createContext, useActionState, useContext, useEffect, useState, type ReactNode } from "react";

import { btnCls, btnGhostCls, Card, cn, inputCls, labelCls } from "@/components/ui";
import {
  saveLeadSaleConditionsAction,
  type SaveLeadSaleConditionsActionState,
} from "@/lib/platform-sales-actions";
import {
  CONDITIONS_BUDGET_PERIODS,
  SALE_CONDITION_CURRENCIES,
  type ConditionsBudgetPeriod,
  type LeadSaleConditions as LeadSaleConditionsSnapshot,
  type SaleConditionCurrency,
} from "@/lib/lead-sale-conditions-contract";

/**
 * Shared plumbing for the three progressive-fill card blocks unified
 * workflow S7 adds beside «Условия продажи» (`LeadSaleConditions.tsx`) —
 * «Пожелания», «Образование», «Условия». All four blocks read and write the
 * SAME revision-versioned row (`platform_private.lead_sale_conditions`,
 * migration 181/184): `save_lead_sale_conditions_v1` still replaces the row
 * whole on every save (181, unchanged in this slice), so every block
 * submits the FULL 26-key set — its own edited slice as visible fields,
 * every other key as a hidden passthrough carrying the OTHER blocks'
 * current, unedited values.
 *
 * Post-review fix: a save used to bump the shared revision by calling
 * `router.refresh()`, which made the parent (`tabs.tsx`) remount every one
 * of the four blocks via `key={`…:${revision}`}` — including the THREE that
 * were not saved. That silently wiped whatever a sibling block had typed
 * but not yet submitted. `SaleConditionsRevisionProvider` below replaces
 * that: mounted once around all four blocks, it holds the shared
 * `expected_revision` value client-side. Each block reads it from context
 * (not from its own `conditions.revision` prop, which is only the page's
 * last SSR snapshot) and, on its own saved result, calls `bump` with the
 * action's returned revision — no refresh, no remount, sibling drafts
 * untouched. The trade-off: `conditions` itself (every OTHER field these
 * blocks read for their hidden passthrough / initial draft, and the linked
 * sales-register preview in `LeadSaleConditions.tsx`) still reflects only
 * the last SSR fetch and can go stale across saves until an explicit
 * refresh — acceptable per review, and why the "stale"/"request_conflict"
 * outcomes below keep their own explicit «Обновить» button instead of
 * auto-refreshing.
 */

type SaleConditionsRevisionState = Readonly<{ revision: string; bump: (next: string) => void }>;
const SaleConditionsRevisionContext = createContext<SaleConditionsRevisionState | null>(null);

/** Mounted once in `tabs.tsx` around all four sibling card blocks — see the doc comment above. */
export function SaleConditionsRevisionProvider({
  initialRevision,
  children,
}: Readonly<{ initialRevision: number; children: ReactNode }>) {
  const [revision, setRevision] = useState(() => String(initialRevision));
  return (
    <SaleConditionsRevisionContext.Provider value={{ revision, bump: setRevision }}>
      {children}
    </SaleConditionsRevisionContext.Provider>
  );
}

/** Exported for `LeadSaleConditions.tsx`, the fourth sibling block. */
export function useSaleConditionsRevision(): SaleConditionsRevisionState {
  const ctx = useContext(SaleConditionsRevisionContext);
  if (!ctx) {
    throw new Error(
      "LeadSaleConditions/LeadWishesCard/LeadEducationCard/LeadConditionsCard require SaleConditionsRevisionProvider",
    );
  }
  return ctx;
}

const MESSAGES: Record<Exclude<SaveLeadSaleConditionsActionState["status"], "idle">, string> = {
  saved: "Сохранено.",
  invalid: "Проверьте поля.",
  forbidden: "Нет доступа к этому действию.",
  stale: "Данные изменил другой сотрудник. Введённое здесь не потеряно, но «Обновить» заменит его актуальными значениями.",
  request_conflict: "Этот запрос уже использован. Обновите карточку перед повтором.",
  unavailable: "Сохранение не подтверждено. Проверьте подключение и повторите.",
};

/** Every domain key's CURRENT raw string form — the save action's exact field vocabulary. */
function allFieldValues(conditions: LeadSaleConditionsSnapshot): Record<string, string> {
  return {
    service_label: conditions.serviceLabel,
    signing_date: conditions.signingDate ?? "",
    service_cost_raw: conditions.serviceCostRaw,
    service_cost_minor: conditions.serviceCostMinor === null ? "" : String(conditions.serviceCostMinor),
    service_cost_currency: conditions.serviceCostCurrency ?? "",
    paid_raw: conditions.paidRaw,
    paid_minor: conditions.paidMinor === null ? "" : String(conditions.paidMinor),
    paid_currency: conditions.paidCurrency ?? "",
    payment_note: conditions.paymentNote,
    wishes_countries: conditions.wishesCountries,
    wishes_study_fields: conditions.wishesStudyFields,
    wishes_education_level: conditions.wishesEducationLevel,
    wishes_intake_year: conditions.wishesIntakeYear,
    wishes_intake_season: conditions.wishesIntakeSeason,
    wishes_universities: conditions.wishesUniversities,
    education_current: conditions.educationCurrent,
    education_grade: conditions.educationGrade,
    education_marks: conditions.educationMarks,
    education_english: conditions.educationEnglish,
    education_certificates: conditions.educationCertificates,
    conditions_budget_raw: conditions.conditionsBudgetRaw,
    conditions_budget_minor: conditions.conditionsBudgetMinor === null ? "" : String(conditions.conditionsBudgetMinor),
    conditions_budget_currency: conditions.conditionsBudgetCurrency ?? "",
    conditions_budget_period: conditions.conditionsBudgetPeriod ?? "",
    conditions_scholarship: conditions.conditionsScholarship,
    conditions_note: conditions.conditionsNote,
  };
}

function useCardFieldsAction(requestId: string) {
  const router = useRouter();
  const { revision, bump } = useSaleConditionsRevision();
  const [state, action, pending] = useActionState(
    saveLeadSaleConditionsAction,
    { status: "idle", requestId, leadId: null, revision: null } as SaveLeadSaleConditionsActionState,
  );
  // No router.refresh()/remount on save (see the doc comment above): bump
  // the shared context revision instead, so every block's NEXT submit
  // carries the fresh expected_revision without touching a sibling's
  // in-progress draft. This block's own fields stay locked after its save
  // (`locked` below) until the page is next refreshed — saving is still an
  // honest, terminal action for the fields that were just submitted.
  // A "stale"/"request_conflict" result deliberately does NOT auto-refresh
  // either (would wipe THIS block's own unsaved draft) — the explicit
  // «Обновить» button below does it instead.
  useEffect(() => {
    if (state.status === "saved" && state.revision !== null) bump(state.revision);
  }, [bump, state.status, state.revision]);
  return { state, action, pending, router, revision };
}

function HiddenPassthrough({ values, own }: Readonly<{ values: Record<string, string>; own: ReadonlySet<string> }>) {
  return (
    <>
      {Object.entries(values)
        .filter(([key]) => !own.has(key))
        .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    </>
  );
}

function StatusRow({
  state, pending, router,
}: Readonly<{ state: SaveLeadSaleConditionsActionState; pending: boolean; router: ReturnType<typeof useRouter> }>) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || state.status === "saved"} className={cn(btnCls, "min-h-11")}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
        {state.status !== "idle" ? (
          <p role={state.status === "saved" ? "status" : "alert"} className="text-sm text-fg-2">
            {MESSAGES[state.status]}
          </p>
        ) : null}
      </div>
      {state.status === "stale" || state.status === "request_conflict" ? (
        <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={() => router.refresh()}>
          Обновить карточку
        </button>
      ) : null}
    </>
  );
}

type SimpleField = Readonly<{
  key: string;
  label: string;
  kind: "text" | "textarea";
  maxLength: number;
  inputMode?: "numeric";
  pattern?: string;
  selectOptions?: readonly string[];
}>;

function SimpleFieldsCard({
  leadId, conditions, requestId, readOnly, title, testId, fields,
}: Readonly<{
  leadId: string; conditions: LeadSaleConditionsSnapshot; requestId: string; readOnly: boolean;
  title: string; testId: string; fields: readonly SimpleField[];
}>) {
  const { state, action, pending, router, revision } = useCardFieldsAction(requestId);
  const base = allFieldValues(conditions);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, base[field.key]])));
  const locked = readOnly || pending || state.status === "saved";
  const own = new Set(fields.map((field) => field.key));

  return (
    <Card eyebrow title={title}>
      <div className="space-y-4 p-4" data-testid={testId}>
        <form action={action} className="space-y-4" aria-busy={pending}>
          <input type="hidden" name="lead_id" value={leadId} />
          <input type="hidden" name="expected_revision" value={revision} />
          <input type="hidden" name="request_id" value={state.requestId} />
          {fields.map((field) => (
            <label key={field.key} className="block">
              <span className={labelCls}>{field.label}</span>
              {field.selectOptions ? (
                <select
                  name={field.key}
                  value={draft[field.key]}
                  disabled={locked}
                  onChange={(event) => setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))}
                  className={cn(inputCls, "min-h-11 w-full")}
                >
                  <option value="">Не указано</option>
                  {field.selectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : field.kind === "textarea" ? (
                <textarea
                  name={field.key}
                  value={draft[field.key]}
                  maxLength={field.maxLength}
                  rows={2}
                  disabled={locked}
                  onChange={(event) => setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))}
                  className={cn(inputCls, "w-full")}
                />
              ) : (
                <input
                  name={field.key}
                  value={draft[field.key]}
                  maxLength={field.maxLength}
                  inputMode={field.inputMode}
                  pattern={field.pattern}
                  disabled={locked}
                  onChange={(event) => setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))}
                  className={cn(inputCls, "min-h-11 w-full")}
                />
              )}
            </label>
          ))}
          <HiddenPassthrough values={base} own={own} />
          <StatusRow state={state} pending={pending} router={router} />
        </form>
      </div>
    </Card>
  );
}

/** «Пожелания» (plan §5): страны, направления, уровень образования, интейк, вузы. */
export function LeadWishesCard(props: Readonly<{
  leadId: string; conditions: LeadSaleConditionsSnapshot; requestId: string; readOnly?: boolean;
}>) {
  return (
    <SimpleFieldsCard
      {...props}
      readOnly={props.readOnly ?? false}
      title="Пожелания"
      testId="v3-lead-wishes"
      fields={[
        { key: "wishes_countries", label: "Страны", kind: "text", maxLength: 500 },
        { key: "wishes_study_fields", label: "Направления", kind: "text", maxLength: 500 },
        { key: "wishes_education_level", label: "Уровень образования", kind: "text", maxLength: 200 },
        { key: "wishes_intake_year", label: "Год поступления", kind: "text", maxLength: 4, inputMode: "numeric", pattern: "(19|20|21)[0-9]{2}" },
        { key: "wishes_intake_season", label: "Сезон поступления", kind: "text", maxLength: 100, selectOptions: ["весна", "лето", "осень", "зима"] },
        { key: "wishes_universities", label: "Интересующие университеты", kind: "textarea", maxLength: 2000 },
      ]}
    />
  );
}

/** «Образование» (plan §5): текущее образование, класс/курс, оценки, английский, сертификаты. */
export function LeadEducationCard(props: Readonly<{
  leadId: string; conditions: LeadSaleConditionsSnapshot; requestId: string; readOnly?: boolean;
}>) {
  return (
    <SimpleFieldsCard
      {...props}
      readOnly={props.readOnly ?? false}
      title="Образование"
      testId="v3-lead-education"
      fields={[
        { key: "education_current", label: "Текущее образование", kind: "text", maxLength: 300 },
        { key: "education_grade", label: "Класс / курс", kind: "text", maxLength: 100 },
        { key: "education_marks", label: "Оценки", kind: "text", maxLength: 300 },
        { key: "education_english", label: "Уровень английского", kind: "text", maxLength: 300 },
        { key: "education_certificates", label: "Сертификаты", kind: "textarea", maxLength: 2000 },
      ]}
    />
  );
}

function decimal(minor: string): string {
  if (minor === "") return "";
  const value = Number(minor);
  return Number.isSafeInteger(value) ? `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}` : "";
}
function toMinor(value: string): string {
  if (value.trim() === "") return "";
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(normalized)) return "invalid";
  const [whole, cents = ""] = normalized.split(".");
  return String(BigInt(whole) * BigInt(100) + BigInt(cents.padEnd(2, "0")));
}
const BUDGET_PERIOD_LABEL: Record<ConditionsBudgetPeriod, string> = { year: "в год", program: "за программу" };

/** «Условия» (plan §5): бюджет с валютой и периодом, стипендия, пожелания/ограничения. */
export function LeadConditionsCard({
  leadId, conditions, requestId, readOnly = false,
}: Readonly<{ leadId: string; conditions: LeadSaleConditionsSnapshot; requestId: string; readOnly?: boolean }>) {
  const { state, action, pending, router, revision } = useCardFieldsAction(requestId);
  const base = allFieldValues(conditions);
  const [budgetAmount, setBudgetAmount] = useState(() => decimal(base.conditions_budget_minor));
  const [budgetCurrency, setBudgetCurrency] = useState(() => base.conditions_budget_currency);
  const [budgetPeriod, setBudgetPeriod] = useState(() => base.conditions_budget_period);
  const [scholarship, setScholarship] = useState(() => base.conditions_scholarship);
  const [note, setNote] = useState(() => base.conditions_note);
  const locked = readOnly || pending || state.status === "saved";
  const own = new Set(["conditions_budget_raw", "conditions_budget_minor", "conditions_budget_currency", "conditions_budget_period", "conditions_scholarship", "conditions_note"]);

  return (
    <Card eyebrow title="Условия">
      <div className="space-y-4 p-4" data-testid="v3-lead-conditions">
        <form action={action} className="space-y-4" aria-busy={pending}>
          <input type="hidden" name="lead_id" value={leadId} />
          <input type="hidden" name="expected_revision" value={revision} />
          <input type="hidden" name="request_id" value={state.requestId} />
          <div className="grid gap-3 @2xl:grid-cols-2">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <label>
                <span className={labelCls}>Бюджет</span>
                <input
                  inputMode="decimal"
                  pattern="[0-9]+([.,][0-9]{1,2})?"
                  value={budgetAmount}
                  disabled={locked}
                  onChange={(event) => setBudgetAmount(event.target.value)}
                  className={cn(inputCls, "min-h-11 w-full")}
                />
              </label>
              <select
                value={budgetCurrency}
                disabled={locked}
                onChange={(event) => setBudgetCurrency(event.target.value)}
                className={cn(inputCls, "min-h-11 w-full")}
              >
                <option value="">Не указана</option>
                {SALE_CONDITION_CURRENCIES.map((code: SaleConditionCurrency) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <label>
              <span className={labelCls}>Период</span>
              <select
                value={budgetPeriod}
                disabled={locked}
                onChange={(event) => setBudgetPeriod(event.target.value)}
                className={cn(inputCls, "min-h-11 w-full")}
              >
                <option value="">Не указан</option>
                {CONDITIONS_BUDGET_PERIODS.map((period) => <option key={period} value={period}>{BUDGET_PERIOD_LABEL[period]}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className={labelCls}>Стипендия</span>
            <input
              value={scholarship}
              maxLength={500}
              disabled={locked}
              onChange={(event) => setScholarship(event.target.value)}
              className={cn(inputCls, "min-h-11 w-full")}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Ограничения и пожелания</span>
            <textarea
              value={note}
              maxLength={2000}
              rows={2}
              disabled={locked}
              onChange={(event) => setNote(event.target.value)}
              className={cn(inputCls, "w-full")}
            />
          </label>
          <input type="hidden" name="conditions_budget_raw" value={budgetAmount} />
          <input type="hidden" name="conditions_budget_minor" value={toMinor(budgetAmount)} />
          <input type="hidden" name="conditions_budget_currency" value={budgetCurrency} />
          <input type="hidden" name="conditions_budget_period" value={budgetPeriod} />
          <input type="hidden" name="conditions_scholarship" value={scholarship} />
          <input type="hidden" name="conditions_note" value={note} />
          <HiddenPassthrough values={base} own={own} />
          <StatusRow state={state} pending={pending} router={router} />
        </form>
      </div>
    </Card>
  );
}
