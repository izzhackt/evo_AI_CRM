"use client";
import Link from "next/link";
import { useState } from "react";

import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { draftSync, type GeoCity, type GeoInstitution } from "@/lib/catalog-geography";

/** Выбору города нужны только ключ, страна, название и статус (тексты городов в браузер не уходят, review CRM R3). */
export type CityOption = Readonly<Pick<GeoCity, "key" | "country" | "nameRu" | "status">>;

import { BusyLabel, CommandResult, FIELD, GHOST, LABEL, QUIET, useGeographyCommand } from "./command";

/**
 * «Город» в карточке вуза (план 7.5): выбор из справочника городов страны
 * вуза. Строка `content.city` карточки не меняется, связь хранится рядом
 * (`catalog_institution_cities`). Без города вуз виден студенту в «Других
 * вузах страны»; город-черновик студент тоже не видит.
 *
 * Выбор следует за сохранённой связью (review CRM V3): RPC 283 версии связи
 * не принимает, поэтому защиту держит форма. Пришла другая связь, а свой
 * выбор не сделан (или совпал с ней): выбор показывает её. Свой выбор
 * сделан: он остаётся, но сохранить его поверх связи, которую сотрудник не
 * видел, нельзя, пока он не посмотрит сохранённый город.
 */
export function UniversityCityPicker({ institution, cities }: Readonly<{ institution: GeoInstitution; cities: readonly CityOption[] }>) {
  const saved = institution.cityKey ?? "";
  const [choice, setChoice] = useState(saved);
  const [base, setBase] = useState(saved);
  if (saved !== base && draftSync({ ownEdits: choice !== base, matchesSaved: choice === saved, reloadRequested: false }) === "adopt") { setBase(saved); setChoice(saved); }
  const behind = saved !== base;
  const { state, run, pending, refresh } = useGeographyCommand("institution_city_set");
  const own = cities.filter((city) => city.country === institution.country).sort((a, b) => a.nameRu.localeCompare(b.nameRu, "ru"));
  const current = own.find((city) => city.key === institution.cityKey) ?? null;
  const chosen = own.find((city) => city.key === choice) ?? null;
  const changed = choice !== saved;
  const name = (city: CityOption | null) => (city ? `«${city.nameRu}»` : "«Без города»");
  return (
    <section aria-labelledby="university-city-heading" className="space-y-3" data-testid="university-city-picker">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="university-city-heading" className="t-section text-fg">Город в кабинете студента</h2>
        <Link className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg" href="/v3/universities/cities">Все города</Link>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => { event.preventDefault(); if (changed && !behind) run({ institutionId: institution.id, cityKey: choice || null }); }}
      >
        <label className={`${LABEL} min-w-0 flex-1 basis-64`}>
          Город из справочника
          <select className={FIELD} value={choice} disabled={pending} onChange={(event) => setChoice(event.target.value)}>
            <option value="">Без города: «Другие вузы страны»</option>
            {own.map((city) => <option key={city.key} value={city.key}>{city.nameRu}{city.status === "draft" ? " (черновик)" : ""}</option>)}
          </select>
        </label>
        <button type="submit" className={GHOST} disabled={pending || !changed || behind}><BusyLabel busy={pending} label="Сохранить город" /></button>
      </form>
      {behind ? (
        <p role="status" className="flex flex-wrap items-center gap-x-3 t-body-compact text-warn" data-testid="university-city-behind">
          Город вуза изменили, пока вы выбирали: сохранён {name(current)}. Ваш выбор {name(chosen)} не сохранён, сохранить его поверх нельзя.
          <button type="button" className={QUIET} onClick={() => { setBase(saved); setChoice(saved); }}>Показать сохранённый город</button>
        </p>
      ) : null}
      <dl className="flex flex-wrap gap-x-5 gap-y-1 t-meta text-fg-2">
        <div className="flex gap-1"><dt className="text-fg-3">В карточке вуза:</dt><dd>{institution.cityLabel ?? "город не указан"}</dd></div>
        <div className="flex gap-1"><dt className="text-fg-3">Связь:</dt><dd>{current ? `${current.nameRu}, ${institution.assignedVia === "staff" ? "назначил сотрудник" : "назначен при первой загрузке"}` : "нет"}</dd></div>
      </dl>
      {chosen?.status === "draft" ? (
        <p className="flex flex-wrap items-center gap-2 t-body-compact text-fg-2">
          <StatusChip label="Черновик" tone="warn" />
          Пока карточка города не опубликована, студент видит вуз в «Других вузах страны».
          <Link className="t-label text-fg-2 underline underline-offset-4 hover:text-fg" href={`/v3/universities/cities?city=${chosen.key}`}>Открыть карточку города</Link>
        </p>
      ) : null}
      {!own.length ? <p className="t-body-compact text-fg-2">В справочнике нет городов этой страны. <Link className="t-label underline underline-offset-4" href={`/v3/universities/cities?new=${institution.country}`}>Добавить город</Link></p> : null}
      {/* Итог сохранения говорит о сохранённой связи (из перечитанной карточки) и прячется, как только выбор снова изменён. */}
      {state.status !== "saved" || !changed ? <CommandResult state={state} saved={current ? `Город сохранён: ${current.nameRu}.` : "Связь с городом снята."} refresh={refresh} /> : null}
    </section>
  );
}
