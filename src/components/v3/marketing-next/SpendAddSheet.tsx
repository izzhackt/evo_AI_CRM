"use client";

import { PlusIcon } from "lucide-react";
import { startTransition, useActionState, useRef, useState } from "react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SPEND_CURRENCIES, type SpendFormState } from "@/lib/marketing-contract";
import { addMarketingSpendAction } from "@/lib/platform-marketing-actions";

const MESSAGES: Record<SpendFormState["status"], string> = {
  idle: "",
  saved: "Расход записан.",
  invalid: "Проверьте даты (не больше 366 дней), сумму и валюту.",
  forbidden: "Нет права на это действие. Обновите страницу.",
  request_conflict: "Этот запрос уже записан с другими данными. Проверьте расходы; если нужной записи нет, отправьте форму ещё раз.",
  unavailable: "Результат пока неизвестен. Данные остались в форме; безопасно повторите, не меняя их.",
};

function Field({ id, label, children }: Readonly<{ id: string; label: string; children: React.ReactNode }>) {
  return <div className="grid gap-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

/**
 * Запись ручного расхода в панели: те же поля (`period_start`, `period_end`, `amount`, `currency`, `campaign`, `note`), то же действие
 * `addMarketingSpendAction` и тот же порядок request_id, что у прежней формы: повтор при неизвестном результате идёт с прежним id,
 * после записи и конфликта запроса — с новым. Отправка не через `<form action>`: React 19 сбросил бы введённое после любого ответа.
 */
export function SpendAddSheet({ requestId, defaultStart, defaultEnd }: Readonly<{ requestId: string; defaultStart: string; defaultEnd: string }>) {
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (previous: SpendFormState, form: FormData): Promise<SpendFormState> => {
    try {
      const result = await addMarketingSpendAction(previous, form);
      if (result.status === "saved") formRef.current?.reset();
      if (result.status === "saved" || result.status === "request_conflict") setCurrentRequestId(crypto.randomUUID());
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId } as SpendFormState);
  return (
    <DetailSheet
      title="Добавить расход"
      help="Сумма и валюта (USD, KGS, EUR) записываются как есть, без пересчёта. В итог и цену заявки входят только записи, целиком лежащие в периоде."
      trigger={<Button variant="outline"><PlusIcon aria-hidden="true" />Добавить расход</Button>}
    >
      <form ref={formRef} aria-busy={pending} className="grid gap-4" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => action(form));
      }}>
        <input type="hidden" name="request_id" value={currentRequestId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="spend-start" label="С какого дня"><Input id="spend-start" name="period_start" type="date" required defaultValue={defaultStart} /></Field>
          <Field id="spend-end" label="По какой день"><Input id="spend-end" name="period_end" type="date" required defaultValue={defaultEnd} /></Field>
          <Field id="spend-amount" label="Сумма"><Input id="spend-amount" name="amount" inputMode="decimal" required maxLength={16} /></Field>
          <Field id="spend-currency" label="Валюта">
            <NativeSelect id="spend-currency" name="currency" required defaultValue="USD">{SPEND_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</NativeSelect>
          </Field>
        </div>
        <Field id="spend-campaign" label="Кампания, если есть"><Input id="spend-campaign" name="campaign" maxLength={100} /></Field>
        <Field id="spend-note" label="Пометка"><Input id="spend-note" name="note" maxLength={500} /></Field>
        <div><Button type="submit" variant="outline" disabled={pending}>{pending ? "Записываем…" : "Записать расход"}</Button></div>
        {state.status !== "idle" ? <p role={state.status === "saved" ? "status" : "alert"} className={`t-body-compact ${state.status === "saved" ? "text-fg-2" : "text-danger"}`}>{MESSAGES[state.status]}</p> : null}
      </form>
    </DetailSheet>
  );
}
