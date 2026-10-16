import Link from "next/link";

import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import { cityMissing, type GeoCity, type GeoInstitution, type StaffGeography } from "@/lib/catalog-geography";

/*
 * «Города» (план 7.5): справочник городов шести стран с карточкой для
 * кабинета студента. Таблица на волосяных линиях, как каталог (Э6): строка
 * открывает редактор карточки. Ниже вузы без города: у студента они в
 * «Других вузах страны», связь ставится в карточке вуза.
 */
const ROW = "grid grid-cols-1 gap-x-3 gap-y-0.5 @min-[44rem]/cities:grid-cols-[minmax(0,30fr)_minmax(0,8fr)_minmax(0,34fr)_minmax(0,14fr)_minmax(0,14fr)] @min-[44rem]/cities:items-center";
const HEAD = "t-caption flex h-8 items-center px-2 text-start text-fg-2 first:ps-3";
const CELL = "min-w-0 px-3 @min-[44rem]/cities:px-2";
const dayText = (value: string) => value.split("-").reverse().join(".");

function CityRow({ city }: Readonly<{ city: GeoCity }>) {
  const missing = cityMissing(city);
  return (
    <tr role="row" data-city-row={city.key} className={`v3-queue-row relative ${ROW} border-b border-border py-2 hover:bg-surface`}>
      <th role="rowheader" scope="row" className={`${CELL} text-start font-normal @min-[44rem]/cities:ps-3`}>
        <Link href={`/v3/universities/cities?city=${city.key}`} data-queue-open="" className="t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline hover:underline-offset-4">{city.nameRu}</Link>
        <span className="block truncate t-meta text-fg-2">{city.nameEn} · <span className="font-mono">{city.key}</span></span>
      </th>
      <td role="cell" className={`${CELL} t-body-compact tabular-nums text-fg`}><span className="@min-[44rem]/cities:sr-only">Вузов: </span>{city.institutionCount}</td>
      <td role="cell" className={`${CELL} t-body-compact text-fg-2`}>
        {missing.length ? <span className="text-warn">Не хватает: {missing.join(", ")}</span> : <span>Полная</span>}
      </td>
      <td role="cell" className={CELL}><StatusChip label={city.status === "published" ? "Видят студенты" : "Черновик"} tone={city.status === "published" ? "ok" : "neutral"} /></td>
      <td role="cell" className={`${CELL} t-meta text-fg-2`}>
        <span className="@min-[44rem]/cities:sr-only">Факт проверен </span>
        {city.factVerifiedOn ? <time className="font-mono tabular-nums" dateTime={city.factVerifiedOn}>{dayText(city.factVerifiedOn)}</time> : <span className="text-fg-3">не проверен</span>}
      </td>
    </tr>
  );
}

export function CityList({ geography, country }: Readonly<{ geography: StaffGeography; country: string | null }>) {
  const countries = geography.countries;
  const cities = geography.cities.filter((city) => country === null || city.country === country);
  const unlinked = geography.institutions.filter((item) => item.cityKey === null && (country === null || item.country === country));
  const publishedCities = new Set(geography.cities.filter((city) => city.status === "published").map((city) => city.key));
  // Вуз с городом для студента: связь с опубликованной карточкой (иначе он в «Других вузах страны»).
  const linked = geography.institutions.filter((item) => item.published && item.cityKey !== null && publishedCities.has(item.cityKey)).length;
  const kyPending = geography.cities.filter((city) => city.kyReview === "pending" && (city.summaryKy || city.factKy)).length;
  const published = geography.institutions.filter((item) => item.published).length;
  const tabs = [
    { key: "all", label: "Все страны", href: "/v3/universities/cities", count: geography.cities.length, current: country === null },
    ...countries.map((item) => ({ key: item.code, label: item.nameRu, href: `/v3/universities/cities?country=${item.code}`, count: geography.cities.filter((city) => city.country === item.code).length, current: country === item.code })),
  ];
  const name = (code: string) => countries.find((item) => item.code === code)?.nameRu ?? code;
  return (
    <div className="@container/cities space-y-4">
      <p className="t-body-compact text-fg-2" data-testid="cities-summary">
        Студенты видят <span className="tabular-nums">{publishedCities.size}</span> из <span className="tabular-nums">{geography.cities.length}</span> городов
        {" · "}вузов в опубликованных городах: <span className="tabular-nums">{linked}</span> из <span className="tabular-nums">{published}</span>
        {kyPending ? <>{" · "}кыргызский текст ждёт проверки носителем: <span className="tabular-nums">{kyPending}</span></> : null}
      </p>
      <QueueViewTabs label="Страна" tabs={tabs} />
      {cities.length ? (
        <table role="table" className="block w-full" data-testid="cities-table">
          <caption className="sr-only">Города{country ? `: ${name(country)}` : " шести стран"}, по названию</caption>
          <thead role="rowgroup" className="sr-only @min-[44rem]/cities:not-sr-only @min-[44rem]/cities:block">
            <tr role="row" className={`${ROW} border-b border-border`}>
              {["Город", "Вузов", "Карточка", "Публикация", "Факт проверен"].map((label) => <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>)}
            </tr>
          </thead>
          <tbody role="rowgroup" className="block">
            {cities.map((city) => <CityRow key={city.key} city={city} />)}
          </tbody>
        </table>
      ) : (
        <p className="rounded-card border border-border bg-surface px-4 py-5 t-body-compact text-fg-2">
          {country ? `Городов страны «${name(country)}» в справочнике нет.` : "Справочник городов пуст."} Добавьте город: карточка останется черновиком, пока в ней нет фото, текста и факта с источником.
        </p>
      )}
      <UnlinkedInstitutions institutions={unlinked} name={name} />
    </div>
  );
}

function UnlinkedInstitutions({ institutions, name }: Readonly<{ institutions: readonly GeoInstitution[]; name: (code: string) => string }>) {
  return (
    <section aria-labelledby="unlinked-heading" className="space-y-2 pt-4" data-testid="unlinked-institutions">
      <h2 id="unlinked-heading" className="t-section text-fg">Вузы без города <span className="font-normal tabular-nums text-fg-3">{institutions.length}</span></h2>
      {institutions.length ? (
        <>
          <p className="t-body-compact text-fg-2">Студент видит их в «Других вузах страны». Город выбирается в карточке вуза.</p>
          <ul className="divide-y divide-border border-y border-border">
            {institutions.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                <span className="min-w-0">
                  {item.published ? <Link className="t-item text-fg underline-offset-4 hover:underline" href={`/v3/universities/${item.id}`}>{item.name}</Link> : <span className="t-item text-fg">{item.name}</span>}
                  <span className="block t-meta text-fg-2">{name(item.country)}{item.cityLabel ? ` · в карточке: ${item.cityLabel}` : ""}</span>
                </span>
                {item.published ? null : <StatusChip label="Карточка не опубликована" />}
              </li>
            ))}
          </ul>
        </>
      ) : <p role="status" className="t-body-compact text-fg-2">У всех вузов есть город.</p>}
    </section>
  );
}
