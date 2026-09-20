"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { btnCls, btnGhostCls, Card, cn, inputCls, labelCls } from "@/components/ui";
import {
  saveLeadSaleConditionsGroupAction,
  type SaveLeadSaleConditionsActionState,
} from "@/lib/platform-sales-actions";
import {
  SALE_CONDITION_CURRENCIES,
  type LeadSaleConditions as LeadSaleConditionsSnapshot,
  type SaleConditionCurrency,
} from "@/lib/lead-sale-conditions-contract";
import { useSaleConditionsRevision } from "./LeadCardFieldsForm";

const MESSAGES: Record<Exclude<SaveLeadSaleConditionsActionState["status"], "idle">, string> = {
  saved: "Сохранено.",
  invalid: "Проверьте поля, суммы и валюту.",
  forbidden: "Нет доступа к этому действию.",
  stale: "Условия изменил другой сотрудник. Введённое здесь не потеряно, но «Обновить» заменит его актуальными значениями.",
  request_conflict: "Этот запрос уже использован. Обновите карточку перед повтором.",
  unavailable: "Сохранение не подтверждено. Проверьте подключение и повторите.",
};

const MONTH_LABEL = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "Asia/Bishkek" });

function decimal(minor: number | null): string {
  return minor === null ? "" : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
function toMinor(value: string): string {
  if (value.trim() === "") return "";
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(normalized)) return "invalid";
  const [whole, cents = ""] = normalized.split(".");
  return String(BigInt(whole) * BigInt(100) + BigInt(cents.padEnd(2, "0")));
}
function reportMonthLabel(reportMonth: string): string {
  const parsed = new Date(`${reportMonth}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) ? MONTH_LABEL.format(parsed) : reportMonth;
}
function reportHref(reportMonth: string, recordId: string): string {
  const [year, month] = reportMonth.split("-");
  return `/v3/main?view=sales&year=${year}&month=${Number(month)}&record=${recordId}`;
}

type Draft = Readonly<{
  serviceLabel: string; signingDate: string; costAmount: string; costCurrency: string;
  paidAmount: string; paidCurrency: string; paymentNote: string;
}>;

function draftFrom(conditions: LeadSaleConditionsSnapshot): Draft {
  return {
    serviceLabel: conditions.serviceLabel, signingDate: conditions.signingDate ?? "",
    costAmount: decimal(conditions.serviceCostMinor), costCurrency: conditions.serviceCostCurrency ?? "",
    paidAmount: decimal(conditions.paidMinor), paidCurrency: conditions.paidCurrency ?? "",
    paymentNote: conditions.paymentNote,
  };
}

/**
 * «Условия продажи» — unified workflow S2 (plan §5/§6). Filling this block
 * never adds a row to the sales report; the report reads these exact fields
 * back once a Sales rep chooses this lead and a curator and saves.
 *
 * This is one of FOUR sibling blocks (with «Пожелания»/«Образование»/
 * «Условия» in `LeadCardFieldsForm.tsx`) sharing the same revisioned row —
 * see `SaleConditionsRevisionProvider`'s doc comment there for why
 * `expected_revision` comes from that shared context instead of this
 * block's own `conditions.revision` prop, and why a save here no longer
 * calls `router.refresh()`.
 */
export function LeadSaleConditions({
  leadId,
  conditions,
  requestId,
  readOnly = false,
}: {
  leadId: string;
  conditions: LeadSaleConditionsSnapshot;
  requestId: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { revision, bump } = useSaleConditionsRevision();
  const [draft, setDraft] = useState(() => draftFrom(conditions));
  const [state, action, pending] = useActionState(
    saveLeadSaleConditionsGroupAction,
    { status: "idle", requestId, leadId, revision: null } as SaveLeadSaleConditionsActionState,
  );
  const locked = readOnly || pending || state.status === "saved";
  const update = (key: keyof Draft, value: string) => setDraft((previous) => ({ ...previous, [key]: value }));

  // No router.refresh()/remount on save: that used to remount all four
  // sibling blocks (key={`…:${revision}`} in tabs.tsx), wiping whatever
  // «Пожелания»/«Образование»/«Условия» had typed but not yet saved. We
  // instead bump the shared revision context, so every block's next submit
  // carries the fresh expected_revision; this block's own fields stay
  // locked after its save (`locked` above) until the page is next
  // refreshed. NOTE: the linked sales-register preview below
  // (`conditions.linkedSalesRegister`) still reflects only the last SSR
  // fetch and can go stale across saves until an explicit refresh —
  // acceptable per review.
  // On "stale"/"request_conflict" we deliberately do NOT auto-refresh
  // either: that would wipe the user's own unsaved draft here. The explicit
  // «Обновить» button below does it instead.
  useEffect(() => {
    if (state.status === "saved" && state.revision !== null) bump(state.revision);
  }, [bump, state.status, state.revision]);

  const currencySelect = (label: string, value: string, onChange: (value: string) => void) => (
    <label>
      <span className={labelCls}>{label}</span>
      <select value={value} disabled={locked} onChange={(event) => onChange(event.target.value)} className={cn(inputCls, "min-h-11 w-full")}>
        <option value="">Не указана</option>
        {SALE_CONDITION_CURRENCIES.map((code: SaleConditionCurrency) => (
          <option key={code} value={code}>{code}</option>
        ))}
      </select>
    </label>
  );

  return (
    <Card eyebrow title="Условия продажи" id="sale-conditions">
      <div className="space-y-4 p-4" data-testid="v3-lead-sale-conditions">
        {conditions.linkedSalesRegister ? (
          <p className="text-sm text-fg-2" data-testid="v3-lead-sale-conditions-linked">
            Продажа в отчёте за {reportMonthLabel(conditions.linkedSalesRegister.reportMonth)}
            {": "}
            <Link
              href={reportHref(conditions.linkedSalesRegister.reportMonth, conditions.linkedSalesRegister.id)}
              className="font-semibold text-accent underline underline-offset-4"
            >
              открыть запись
            </Link>
            {conditions.linkedSalesRegister.archived ? " · в архиве" : ""}
          </p>
        ) : null}
        <form action={action} className="space-y-4" aria-busy={pending}>
          <input type="hidden" name="lead_id" value={leadId} />
          <input type="hidden" name="expected_revision" value={revision} />
          <input type="hidden" name="request_id" value={state.requestId} />
          <input type="hidden" name="field_group" value="sale" />
          <label className="block">
            <span className={labelCls}>Услуга/пакет</span>
            <input
              name="service_label"
              value={draft.serviceLabel}
              onChange={(event) => update("serviceLabel", event.target.value)}
              maxLength={300}
              disabled={locked}
              className={cn(inputCls, "min-h-11 w-full")}
            />
          </label>
          <label className="block max-w-60">
            <span className={labelCls}>Дата продажи</span>
            <input
              type="date"
              name="signing_date"
              value={draft.signingDate}
              onChange={(event) => update("signingDate", event.target.value)}
              min="1900-01-01"
              max="2100-12-31"
              disabled={locked}
              className={cn(inputCls, "min-h-11 w-full font-mono text-sm")}
            />
          </label>
          <div className="grid gap-3 @2xl:grid-cols-2">
            <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
              <label>
                <span className={labelCls}>Сумма</span>
                <input
                  inputMode="decimal"
                  pattern="[0-9]+([.,][0-9]{1,2})?"
                  value={draft.costAmount}
                  onChange={(event) => update("costAmount", event.target.value)}
                  disabled={locked}
                  className={cn(inputCls, "min-h-11 w-full")}
                />
              </label>
              {currencySelect("Валюта стоимости", draft.costCurrency, (value) => update("costCurrency", value))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
              <label>
                <span className={labelCls}>Оплачено</span>
                <input
                  inputMode="decimal"
                  pattern="[0-9]+([.,][0-9]{1,2})?"
                  value={draft.paidAmount}
                  onChange={(event) => update("paidAmount", event.target.value)}
                  disabled={locked}
                  className={cn(inputCls, "min-h-11 w-full")}
                />
              </label>
              {currencySelect("Валюта оплаты", draft.paidCurrency, (value) => update("paidCurrency", value))}
            </div>
          </div>
          <label className="block">
            <span className={labelCls}>Заметка об оплате</span>
            <textarea
              name="payment_note"
              value={draft.paymentNote}
              onChange={(event) => update("paymentNote", event.target.value)}
              maxLength={2000}
              rows={2}
              disabled={locked}
              className={cn(inputCls, "w-full")}
            />
          </label>
          <input type="hidden" name="service_cost_raw" value={draft.costAmount} />
          <input type="hidden" name="service_cost_minor" value={toMinor(draft.costAmount)} />
          <input type="hidden" name="service_cost_currency" value={draft.costCurrency} />
          <input type="hidden" name="paid_raw" value={draft.paidAmount} />
          <input type="hidden" name="paid_minor" value={toMinor(draft.paidAmount)} />
          <input type="hidden" name="paid_currency" value={draft.paidCurrency} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={locked} className={cn(btnCls, "min-h-11")}>
              {pending ? "Сохраняем…" : "Сохранить условия"}
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
        </form>
      </div>
    </Card>
  );
}
