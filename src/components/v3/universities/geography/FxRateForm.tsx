"use client";
import { useId, useState } from "react";

import { fxInput, type FxDraft, type FxField, type GeoFxRate } from "@/lib/catalog-geography";

import { BusyLabel, CommandResult, FIELD, FieldError, LABEL, PRIMARY, focusFirstInvalid, useGeographyCommand } from "./command";

const FIELD_ERRORS: Readonly<Record<FxField, string>> = {
  currency: "Код валюты ISO 4217, кроме USD.",
  asOf: "Дата курса не позже сегодняшней.",
  unitsPerUsd: "Сколько единиц валюты за 1 USD, число больше нуля.",
  sourceName: "Название источника курса, до 200 знаков.",
  sourceUrl: "Адрес https:// или пусто.",
};

/**
 * «Внести курс» (план 7.1: admin раз в месяц, с источником; внешних API нет).
 * Тот же день той же валюты исправляет курс. Источник подставляется из
 * последнего курса валюты, его можно изменить.
 */
export function FxRateForm({ currencies, latest, initialCurrency, today }: Readonly<{ currencies: readonly string[]; latest: readonly GeoFxRate[]; initialCurrency: string; today: string }>) {
  const from = (currency: string) => latest.find((rate) => rate.currency === currency) ?? null;
  const [draft, setDraft] = useState<FxDraft>(() => ({ currency: initialCurrency, asOf: today, unitsPerUsd: "", sourceName: from(initialCurrency)?.sourceName ?? "", sourceUrl: from(initialCurrency)?.sourceUrl ?? "" }));
  const [shown, setShown] = useState(false);
  const { state, run, pending, refresh } = useGeographyCommand("fx_rate_set");
  const id = useId();
  const { input, errors } = fxInput(draft, today);
  const set = <K extends keyof FxDraft>(key: K, value: FxDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const error = (field: FxField) => (shown && errors.has(field) ? errors.get(field) ?? FIELD_ERRORS[field] : null);
  const control = (field: FxField) => ({ id: `${id}-${field}`, "aria-invalid": error(field) ? true : undefined, "aria-describedby": error(field) ? `${id}-${field}-error` : undefined });
  return (
    <form
      className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-5"
      data-testid="fx-rate-form"
      id="fx-rate-form"
      aria-labelledby={`${id}-heading`}
      noValidate
      onSubmit={(event) => { event.preventDefault(); setShown(true); if (errors.size === 0) run(input); else focusFirstInvalid(event.currentTarget); }}
    >
      <h2 id={`${id}-heading`} className="t-section text-fg">Внести курс</h2>
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,8rem)_minmax(0,11rem)_minmax(0,11rem)_minmax(0,1fr)_minmax(0,1fr)]">
        <legend className="sr-only">Курс валюты к USD</legend>
        <label className={LABEL}>Валюта
          <select className={FIELD} value={draft.currency} {...control("currency")} onChange={(event) => { const rate = from(event.target.value); setDraft((current) => ({ ...current, currency: event.target.value, sourceName: rate?.sourceName ?? current.sourceName, sourceUrl: rate?.sourceUrl ?? current.sourceUrl })); }}>
            {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label className={LABEL}>Дата курса<input className={`${FIELD} font-mono`} type="date" max={today} value={draft.asOf} {...control("asOf")} onChange={(event) => set("asOf", event.target.value)} required /><FieldError id={`${id}-asOf-error`} text={error("asOf")} /></label>
        <label className={LABEL}>1 USD =<span className="sr-only"> сколько единиц валюты</span>
          <span className="flex items-center gap-2"><input className={`${FIELD} tabular-nums`} inputMode="decimal" value={draft.unitsPerUsd} {...control("unitsPerUsd")} onChange={(event) => set("unitsPerUsd", event.target.value)} required /><span className="mt-1 t-body-compact text-fg-2">{draft.currency}</span></span>
          <FieldError id={`${id}-unitsPerUsd-error`} text={error("unitsPerUsd")} />
        </label>
        <label className={LABEL}>Источник курса<input className={FIELD} value={draft.sourceName} maxLength={200} {...control("sourceName")} onChange={(event) => set("sourceName", event.target.value)} required /><FieldError id={`${id}-sourceName-error`} text={error("sourceName")} /></label>
        <label className={LABEL}>Адрес источника, если есть<input className={FIELD} type="url" value={draft.sourceUrl} {...control("sourceUrl")} onChange={(event) => set("sourceUrl", event.target.value)} /><FieldError id={`${id}-sourceUrl-error`} text={error("sourceUrl")} /></label>
      </fieldset>
      {/* Кнопка над итогом и одного размера во время запроса (review CRM V2). */}
      <button type="submit" className={PRIMARY} disabled={pending}><BusyLabel busy={pending} label={state.status === "unavailable" ? "Повторить" : "Сохранить курс"} /></button>
      <p className="t-meta text-fg-3">Тот же день и валюта: курс заменится.</p>
      <CommandResult state={state} saved={`Курс ${input.currency} на ${input.asOf.split("-").reverse().join(".")} сохранён.`} refresh={refresh} />
    </form>
  );
}
