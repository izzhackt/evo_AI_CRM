"use client";

import { Icon } from "@/components/icons";
import { fieldLabelCls } from "@/components/ui";
import {
  ADMISSIONS_DIRECT_CURRENCIES,
  ADMISSIONS_DIRECT_MAX_PAYMENTS,
  bishkekToday,
} from "@/lib/admissions-direct-student-contract";
import { ADMISSIONS_PIPELINE_TAB_STAGES } from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage, admissionsPipelineTab } from "@/lib/v3/wording";

import { FIELD_CLS, Field, TEXT_ACTION, WIDE, type AddStudentForm } from "./AddStudentFields";

/**
 * «Этап и деньги»: этап на доске во всю ширину, стоимость договора с валютой и дата договора — парой,
 * ниже полученные оплаты списком строк «сумма · валюта · дата». Для Китая стоимость подставлена заранее
 * (1 500 USD) и под полем стоит тихая подпись, пока её не изменили руками.
 */
export function MoneyFields({ form, costPrefilled, onCost, paymentErrors, onPayment, onAddPayment, onRemovePayment }: Readonly<{
  form: AddStudentForm;
  costPrefilled: boolean;
  onCost: (key: "costAmount" | "costCurrency", value: string) => void;
  paymentErrors: readonly (string | null)[];
  onPayment: (index: number, key: "amount" | "currency" | "paidOn", value: string) => void;
  onAddPayment: () => void;
  onRemovePayment: (index: number) => void;
}>) {
  const { draft, ids, set, field, error, errorText } = form;
  return <>
    <Field label="Этап на доске" htmlFor={ids.stage} className={WIDE}>
      <select {...field("stage")} name="stage" className={FIELD_CLS}
        value={draft.stage} onChange={(e) => set("stage", e.target.value)}>
        {(["admission", "visa"] as const).map((tab) => (
          <optgroup key={tab} label={admissionsPipelineTab(tab)}>
            {ADMISSIONS_PIPELINE_TAB_STAGES[tab].map((stage) => (
              <option key={stage} value={stage}>{admissionsPipelineStage(stage) ?? stage}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {errorText("stage")}
    </Field>

    <div className="min-w-0">
      <span className={fieldLabelCls} id={`${ids.costAmount}-label`}>Стоимость договора</span>
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
        <input {...field("costAmount")} aria-labelledby={`${ids.costAmount}-label`} name="costAmount"
          inputMode="decimal" autoComplete="off" maxLength={18} className={`${FIELD_CLS} tabular-nums`}
          value={draft.costAmount} onChange={(e) => onCost("costAmount", e.target.value)} />
        <select {...field("costCurrency")} aria-label="Валюта договора" name="costCurrency"
          className={FIELD_CLS} value={draft.costCurrency}
          onChange={(e) => onCost("costCurrency", e.target.value)}>
          {ADMISSIONS_DIRECT_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </div>
      {errorText("costAmount") ?? errorText("costCurrency")
        ?? (costPrefilled ? <span className="mt-1 block t-meta text-fg-2">По умолчанию для Китая.</span> : null)}
    </div>
    <Field label="Дата договора" htmlFor={ids.signedOn}>
      <input {...field("signedOn")} name="signedOn" type="date" max={bishkekToday()} className={FIELD_CLS}
        value={draft.signedOn} onChange={(e) => set("signedOn", e.target.value)} />
      {errorText("signedOn")}
    </Field>

    <div className={`min-w-0 ${WIDE}`} role="group" aria-labelledby={`${ids.payments}-label`}>
      <span className={fieldLabelCls} id={`${ids.payments}-label`}>Полученные оплаты</span>
      {draft.payments.length > 0 ? (
        // Строки оплат без своей рамки (рамка у карточки): между ними волосяная линия.
        <ul className="divide-y divide-border">
          {draft.payments.map((payment, index) => {
            const rowError = paymentErrors[index] ?? null;
            const rowErrorId = `${ids.payments}-row-${index}`;
            return (
              <li key={index} className="py-2 first:pt-0">
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_10rem_auto]">
                  <input data-payment-amount aria-label={`Сумма оплаты ${index + 1}`} inputMode="decimal" autoComplete="off"
                    maxLength={18} className={`${FIELD_CLS} tabular-nums`} value={payment.amount}
                    aria-invalid={rowError ? true : undefined} aria-describedby={rowError ? rowErrorId : undefined}
                    onChange={(e) => onPayment(index, "amount", e.target.value)} />
                  <select aria-label={`Валюта оплаты ${index + 1}`} className={FIELD_CLS} value={payment.currency}
                    onChange={(e) => onPayment(index, "currency", e.target.value)}>
                    {ADMISSIONS_DIRECT_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                  <input type="date" aria-label={`Дата оплаты ${index + 1}`} className={FIELD_CLS} value={payment.paidOn}
                    max={bishkekToday()} onChange={(e) => onPayment(index, "paidOn", e.target.value)} />
                  <button type="button" onClick={() => onRemovePayment(index)} aria-label={`Убрать оплату ${index + 1}`}
                    className="flex size-11 items-center justify-center justify-self-end rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg">
                    <Icon name="x" size={18} />
                  </button>
                </div>
                {rowError ? <span id={rowErrorId} className="mt-1 block t-body-compact text-danger">{rowError}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {draft.payments.length < ADMISSIONS_DIRECT_MAX_PAYMENTS ? (
        <button type="button" id={ids.payments} onClick={onAddPayment} className={TEXT_ACTION}>
          <Icon name="plus" size={16} />
          Добавить оплату
        </button>
      ) : null}
      {error("payments") ? <span role="alert" className="mt-1 block t-body-compact text-danger">{error("payments")}</span> : null}
    </div>
  </>;
}
