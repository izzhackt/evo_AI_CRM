"use client";
import { startTransition, useActionState, useId, useState } from "react";

import { QUEUE_CONFIRM } from "@/components/staff/queue/queue-buttons";
import { saveCountryCuratorAction } from "@/lib/platform-country-curator-actions";
import {
  COUNTRY_CURATOR_FORM_MESSAGE, COUNTRY_CURATOR_TITLE,
  type CountryCuratorFormState, type CountryCuratorRow,
} from "@/lib/country-curator-contract";

const SELECT = "mt-1 block min-h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg hover:bg-surface-2 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3";
const GOOD = new Set<CountryCuratorFormState["status"]>(["saved", "unchanged"]);

/**
 * Куратор одной страны: выбор сотрудника и «Сохранить». Отправка не через `<form action>`, чтобы выбор не сбрасывался после
 * ответа (как `ReportLinkForm`). Id запроса меняется после определённого ответа и остаётся при неизвестном: повтор вернёт
 * прежнюю квитанцию, а не вторую запись. Версию строки страница читает из базы.
 */
export function CountryCuratorForm({ row, curators, requestId }: Readonly<{
  row: CountryCuratorRow;
  curators: readonly Readonly<{ id: string; label: string }>[];
  requestId: string;
}>) {
  const id = useId();
  const [choice, setChoice] = useState(row.curatorId ?? "");
  const [request, setRequest] = useState(requestId);
  const [state, action, saving] = useActionState(async (previous: CountryCuratorFormState, form: FormData): Promise<CountryCuratorFormState> => {
    try {
      const result = await saveCountryCuratorAction(previous, form);
      if (result.status !== "unavailable") setRequest(crypto.randomUUID());
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId } as CountryCuratorFormState);
  const failed = state.status !== "idle" && !GOOD.has(state.status);
  // Назначенный куратор больше не проходит отбор (уволен, снята роль): в списке его нет, форма продажи его не подставит.
  const missing = row.curatorId !== null && !row.eligible;

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => action(form)); }}
      aria-busy={saving} className="grid gap-3" data-testid={`v3-country-curator-form-${row.direction}`}
    >
      <input type="hidden" name="request_id" value={request} />
      <input type="hidden" name="direction" value={row.direction} />
      <input type="hidden" name="expected_version" value={row.version} />
      <div className="max-w-md">
        <label htmlFor={`${id}-curator`} className="block t-label text-fg-2">Куратор: {COUNTRY_CURATOR_TITLE[row.direction]}</label>
        <select id={`${id}-curator`} name="curator_membership_id" value={choice} onChange={(event) => setChoice(event.target.value)} className={SELECT}>
          <option value="">Не задан</option>
          {curators.map((curator) => <option key={curator.id} value={curator.id}>{curator.label}</option>)}
        </select>
      </div>
      {missing ? <p role="alert" className="t-body-compact text-danger">{row.curatorLabel ?? "Сотрудник"} больше не может быть куратором. Выберите другого.</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="submit" className={QUEUE_CONFIRM} disabled={saving || choice === (row.curatorId ?? "")}>{saving ? "Сохраняем…" : "Сохранить"}</button>
        <p role={failed ? "alert" : "status"} className={`t-body-compact ${failed ? "text-danger" : "text-fg-2"}`}>{COUNTRY_CURATOR_FORM_MESSAGE[state.status]}</p>
      </div>
    </form>
  );
}
