"use client";
/* eslint-disable @next/next/no-img-element -- Превью фото из своего бакета portal-university-photos; без прокси произвольных картинок. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";

import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { CITY_PHOTO_PATH, PHOTO_SOURCES, cityDraft, cityDraftChanged, cityInput, cityMissing, type CityDraft, type CityField, type GeoCity, type GeoPhoto } from "@/lib/catalog-geography";
import { STUDY_COUNTRY_CODES, studyCountryName } from "@/lib/study-countries";

import { AREA, CommandResult, FIELD, FieldError, GHOST, LABEL, PRIMARY, focusFirstInvalid, useGeographyCommand } from "./command";

/*
 * Карточка города (план 7.1, 7.5; контракт 3.2): названия RU/KY/EN, фото
 * из хранилища со ссылкой и авторством, короткий текст и «самый интересный
 * факт» на двух языках с источником и датой. Сохранение не публикует;
 * опубликовать можно только полную сохранённую карточку, чьё фото уже лежит
 * в хранилище, и опубликованная карточка обязана остаться полной. Справа то,
 * что увидит студент: авторство фото у него по кнопке «©», как в кабинете.
 */
const FIELD_ERRORS: Readonly<Partial<Record<CityField, string>>> = {
  key: "Латиница, цифры и дефис, от 2 до 64 знаков, например hangzhou.",
  country: "Одна из шести стран продукта.",
  coordinates: "Широта от -90 до 90 и долгота от -180 до 180, обе или ни одной.",
  photoPath: "Путь вида geography/cities/<страна>-<ключ>-<12 знаков отпечатка файла>.jpg (или png, webp, avif).",
  photoWidth: "Ширина в пикселях, целое число от 1 до 99999.",
  photoHeight: "Высота в пикселях, целое число от 1 до 99999.",
  photoSourceName: "Только Unsplash, Pexels или Wikimedia Commons.",
  photoSourceUrl: "Адрес страницы фото у источника.",
  factVerifiedOn: "Дата проверки не позже сегодняшней.",
};
const LIMITS = { summaryRu: 300, summaryKy: 300, factRu: 200, factKy: 200 } as const;
type PhotoState = "none" | "checking" | "stored" | "missing";

function Counter({ value, max }: Readonly<{ value: string; max: number }>) {
  const length = [...value.trim()].length;
  // Счётчик только у предела (тихий интерфейс 18.09).
  return length > max - 40 ? <span className={`t-meta tabular-nums ${length > max ? "text-danger" : "text-fg-3"}`}>{length} из {max}</span> : null;
}

export function CityEditor({ city, country, today, photoBase }: Readonly<{ city: GeoCity | null; country: string; today: string; photoBase: string | null }>) {
  const router = useRouter();
  const [draft, setDraft] = useState<CityDraft>(() => cityDraft(city, country));
  const [syncedVersion, setSyncedVersion] = useState(city?.version ?? 0);
  const [shown, setShown] = useState(false);
  const [photoLoad, setPhotoLoad] = useState<Readonly<{ src: string; ok: boolean }> | null>(null);
  const save = useGeographyCommand("city_upsert");
  const publish = useGeographyCommand("city_publish");
  const id = useId();
  // Перечитанная после сохранения карточка: если ввод совпал с ней по смыслу
  // (обрезанные пробелы, «30.250» и «30.25»), поля показывают записанное
  // базой, и карточка снова «не изменена» (review CRM R2).
  if (city !== null && city.version !== syncedVersion) {
    setSyncedVersion(city.version);
    if (!cityDraftChanged(draft, city, today)) setDraft(cityDraft(city, city.country));
  }
  const { input, errors } = cityInput(draft, today);
  const dirty = cityDraftChanged(draft, city, today);
  const missing = cityMissing(input);
  const savedMissing = city ? cityMissing(city) : missing;
  const published = city?.status === "published";
  useEffect(() => {
    // Новый город после сохранения открывается по своему адресу (Back и обновление сохраняют смысл).
    if (city === null && save.state.status === "saved") router.replace(`/v3/universities/cities?city=${input.key}`);
  }, [city, save.state, input.key, router]);
  const set = <K extends keyof CityDraft>(key: K, value: CityDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const error = (field: CityField) => (shown && errors.has(field) ? errors.get(field) ?? FIELD_ERRORS[field] ?? "Проверьте поле." : null);
  const control = (field: CityField) => ({ id: `${id}-${field}`, "aria-invalid": shown && errors.has(field) ? true : undefined, "aria-describedby": error(field) ? `${id}-${field}-error` : undefined });
  const path = draft.photoPath.trim();
  const src = photoBase && CITY_PHOTO_PATH.test(path) ? `${photoBase}${path}` : null;
  // Есть ли файл в хранилище, видно по загрузке превью с того же публичного адреса, что у студента.
  const photoState: PhotoState = src === null ? "none" : photoLoad?.src === src ? (photoLoad.ok ? "stored" : "missing") : "checking";
  const seen = (url: string, ok: boolean) => setPhotoLoad((current) => (current?.src === url && current.ok === ok ? current : { src: url, ok }));
  // Опубликованная карточка при правке остаётся опубликованной: сохранить неполную или с незагруженным новым фото нельзя (283).
  const breaksPublished = published && missing.length > 0;
  const newPhotoMissing = published && path !== (city?.photo?.path ?? "") && photoState === "missing";
  const savedPhotoMissing = !dirty && photoState === "missing";
  const pending = save.pending || publish.pending;
  const text = (key: keyof typeof LIMITS, label: string, rows: number, field: CityField) => (
    <label className={LABEL}>
      <span className="flex items-baseline justify-between gap-3">{label}<Counter value={draft[key]} max={LIMITS[key]} /></span>
      <textarea className={AREA} rows={rows} value={draft[key]} maxLength={LIMITS[key] + 20} aria-invalid={shown && errors.has(field) ? true : undefined} aria-describedby={error(field) ? `${id}-${field}-error` : undefined} onChange={(event) => set(key, event.target.value.replace(/[\r\n]+/g, " "))} />
    </label>
  );
  const photoField = (field: keyof CityDraft & CityField, label: string, extra: Readonly<{ type?: string; inputMode?: "numeric"; maxLength?: number; className?: string; wide?: boolean }> = {}) => (
    <label className={`${LABEL}${extra.wide ? " sm:col-span-2" : ""}`}>
      {label}
      <input className={`${FIELD}${extra.className ? ` ${extra.className}` : ""}`} type={extra.type} inputMode={extra.inputMode} maxLength={extra.maxLength} value={draft[field] as string} {...control(field)} onChange={(event) => set(field, event.target.value)} />
      <FieldError id={`${id}-${field}-error`} text={error(field)} />
    </label>
  );
  return (
    <form
      className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
      data-testid="city-editor"
      aria-busy={pending}
      noValidate
      onSubmit={(event) => { event.preventDefault(); setShown(true); if (errors.size === 0 && !breaksPublished && !newPhotoMissing) save.run({ city: input, baseVersion: city?.version ?? 0 }); else focusFirstInvalid(event.currentTarget); }}
    >
      <fieldset disabled={pending} className="min-w-0 space-y-6">
        <legend className="sr-only">Карточка города</legend>
        <Group title="Город">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>Страна
              <select className={FIELD} value={draft.country} disabled={city !== null} {...control("country")} onChange={(event) => set("country", event.target.value)}>
                {STUDY_COUNTRY_CODES.map((code) => <option key={code} value={code}>{studyCountryName(code, "ru")}</option>)}
              </select>
            </label>
            <label className={LABEL}>Ключ в адресе
              <input className={`${FIELD} font-mono`} value={draft.key} readOnly={city !== null} maxLength={64} placeholder="например, suzhou" {...control("key")} onChange={(event) => set("key", event.target.value.toLowerCase())} required />
              <FieldError id={`${id}-key-error`} text={error("key")} />
            </label>
          </div>
          {city ? <p className="t-meta text-fg-3">Страну и ключ после создания не меняют: на них ссылаются вузы и адреса кабинета.</p> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={LABEL}>Название, RU<input className={FIELD} value={draft.nameRu} maxLength={100} {...control("nameRu")} onChange={(event) => set("nameRu", event.target.value)} required /><FieldError id={`${id}-nameRu-error`} text={error("nameRu")} /></label>
            <label className={LABEL}>Название, KY<input className={FIELD} value={draft.nameKy} maxLength={100} {...control("nameKy")} onChange={(event) => set("nameKy", event.target.value)} required /><FieldError id={`${id}-nameKy-error`} text={error("nameKy")} /></label>
            <label className={LABEL}>Название, EN<input className={FIELD} value={draft.nameEn} maxLength={100} {...control("nameEn")} onChange={(event) => set("nameEn", event.target.value)} required /><FieldError id={`${id}-nameEn-error`} text={error("nameEn")} /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>Широта центра<input className={`${FIELD} font-mono`} inputMode="decimal" value={draft.lat} {...control("coordinates")} onChange={(event) => set("lat", event.target.value)} /></label>
            <label className={LABEL}>Долгота центра<input className={`${FIELD} font-mono`} inputMode="decimal" value={draft.lng} aria-invalid={shown && errors.has("coordinates") ? true : undefined} onChange={(event) => set("lng", event.target.value)} /></label>
          </div>
          <FieldError id={`${id}-coordinates-error`} text={error("coordinates")} />
        </Group>
        <Group title="Фото" note="Файл фото загружают в хранилище отдельно, при выпуске; здесь путь к файлу и авторство. Только Unsplash, Pexels или Wikimedia Commons, фото агентств нельзя.">
          {photoField("photoPath", "Путь к файлу в хранилище", { className: "font-mono" })}
          <div className="grid gap-3 sm:grid-cols-4">
            {photoField("photoWidth", "Ширина, px", { inputMode: "numeric", className: "tabular-nums" })}
            {photoField("photoHeight", "Высота, px", { inputMode: "numeric", className: "tabular-nums" })}
            <label className={`${LABEL} sm:col-span-2`}>Источник
              <select className={FIELD} value={draft.photoSourceName} {...control("photoSourceName")} onChange={(event) => set("photoSourceName", event.target.value)}>{PHOTO_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select>
              <FieldError id={`${id}-photoSourceName-error`} text={error("photoSourceName")} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {photoField("photoSourceUrl", "Страница фото у источника", { type: "url" })}
            {photoField("photoAuthor", "Автор", { maxLength: 200 })}
            {photoField("photoAuthorUrl", "Страница автора, если есть", { type: "url" })}
            {photoField("photoLicense", "Лицензия", { maxLength: 120 })}
            {photoField("photoLicenseUrl", "Адрес лицензии, если есть", { type: "url", wide: true })}
          </div>
        </Group>
        <Group title="Тексты для студента">
          <div className="grid gap-3 sm:grid-cols-2">{text("summaryRu", "Коротко о городе, RU", 3, "summary")}{text("summaryKy", "Коротко о городе, KY", 3, "summary")}</div>
          <FieldError id={`${id}-summary-error`} text={error("summary")} />
          <div className="grid gap-3 sm:grid-cols-2">{text("factRu", "Самый интересный факт, RU", 2, "fact")}{text("factKy", "Самый интересный факт, KY", 2, "fact")}</div>
          <FieldError id={`${id}-fact-error`} text={error("fact")} />
          <p className="t-meta text-fg-3">Факт проверяемый: без политики, цен, безопасности и обещаний.</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label className={LABEL}>Источник факта (https)<input className={FIELD} type="url" value={draft.factSourceUrl} {...control("factSourceUrl")} onChange={(event) => set("factSourceUrl", event.target.value)} /><FieldError id={`${id}-factSourceUrl-error`} text={error("factSourceUrl")} /></label>
            <label className={LABEL}>Факт проверен<input className={`${FIELD} font-mono`} type="date" max={today} value={draft.factVerifiedOn} {...control("factVerifiedOn")} onChange={(event) => set("factVerifiedOn", event.target.value)} /><FieldError id={`${id}-factVerifiedOn-error`} text={error("factVerifiedOn")} /></label>
          </div>
          <label className="flex min-h-11 items-center gap-3 t-body-compact text-fg">
            <input type="checkbox" className="size-4" checked={draft.kyReview === "done"} onChange={(event) => set("kyReview", event.target.checked ? "done" : "pending")} />
            Кыргызский текст проверен носителем языка
          </label>
        </Group>
      </fieldset>
      <aside aria-label="Что увидит студент" className="min-w-0 space-y-4 lg:sticky lg:top-6">
        <article className="overflow-hidden rounded-card border border-border bg-surface" data-testid="city-preview">
          <div className="relative">
            {src && photoState !== "missing" ? (
              <img
                key={src}
                src={src}
                alt=""
                width={1280}
                height={853}
                decoding="async"
                referrerPolicy="no-referrer"
                className="aspect-[3/2] w-full bg-surface-2 object-cover"
                // Картинка могла загрузиться до гидратации: тогда события load уже не будет.
                ref={(node) => { if (node?.complete) seen(src, node.naturalWidth > 0); }}
                onLoad={() => seen(src, true)}
                onError={() => seen(src, false)}
              />
            ) : (
              <div className="grid aspect-[3/2] place-items-center bg-surface-2 px-6 text-center t-body-compact text-fg-3" data-testid="city-preview-empty">
                {photoState === "missing" ? "Файла по этому пути в хранилище нет" : path ? "Путь к фото не по правилу" : "Фото нет"}
              </div>
            )}
            {src && photoState !== "missing" && input.photo ? <PreviewCredit photo={input.photo} /> : null}
          </div>
          <div className="space-y-1.5 p-4">
            <p className="t-item text-fg">{draft.nameRu.trim() || "Название города"}</p>
            {draft.summaryRu.trim() ? <p className="t-body-compact text-fg-2">{draft.summaryRu.trim()}</p> : null}
            {draft.factRu.trim() ? <p className="t-body-compact text-fg"><span className="block t-caption text-fg-3">Интересный факт</span>{draft.factRu.trim()}</p> : null}
          </div>
        </article>
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2">
            <StatusChip label={published ? "Видят студенты" : city ? "Черновик" : "Новый город"} tone={published ? "ok" : "neutral"} />
            {city ? <span className="t-meta text-fg-3">Версия {city.version}{city.reviewedByName ? ` · опубликовал ${city.reviewedByName}` : ""}</span> : null}
          </p>
          {missing.length ? <p className="t-body-compact text-warn" data-testid="city-missing">Для публикации не хватает: {missing.join(", ")}.</p> : <p className="t-body-compact text-fg-2">Карточка полная.</p>}
          {breaksPublished ? <p role="alert" className="t-body-compact text-danger">Город видят студенты, поэтому карточка должна остаться полной. Верните поля или сначала снимите город с публикации.</p> : null}
          {newPhotoMissing ? <p role="alert" className="t-body-compact text-danger" data-testid="city-new-photo-missing">Нового фото ещё нет в хранилище, а город видят студенты. Оставьте прежний путь или сохраните после загрузки файла.</p> : null}
          {shown && errors.size ? <p role="alert" className="t-body-compact text-danger">Исправьте отмеченные поля: карточка не сохранена.</p> : null}
          {/* «Сохранено» не висит над новой правкой: итог показан, пока поля совпадают с сохранённой карточкой. */}
          {save.state.status !== "saved" || !dirty ? <CommandResult state={save.state} saved="Карточка сохранена." refresh={save.refresh} /> : null}
          {publish.state.status !== "saved" || !dirty ? <CommandResult state={publish.state} saved={published ? "Город опубликован: студенты видят карточку." : "Город снят с публикации."} refresh={publish.refresh} /> : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={PRIMARY} disabled={pending || !dirty || breaksPublished || newPhotoMissing}>{save.pending ? "Сохраняем…" : save.state.status === "unavailable" ? "Повторить" : city ? "Сохранить изменения" : "Создать черновик"}</button>
            {city ? (
              <button
                type="button"
                className={GHOST}
                disabled={pending || dirty || (!published && (savedMissing.length > 0 || savedPhotoMissing))}
                onClick={() => publish.run({ cityKey: city.key, published: !published, baseVersion: city.version })}
              >
                {publish.pending ? "Сохраняем…" : published ? "Снять с публикации" : "Опубликовать"}
              </button>
            ) : null}
          </div>
          {city && dirty ? <p className="t-meta text-fg-3">Сначала сохраните изменения, затем публикуйте.</p> : null}
          {city && !published && !dirty && savedMissing.length === 0 && savedPhotoMissing ? (
            <p className="t-meta text-warn" data-testid="city-photo-missing">Файла фото ещё нет в хранилище: опубликовать город можно после загрузки фото, иначе студент увидел бы карточку без фото.</p>
          ) : null}
          <Link className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg" href={`/v3/universities/cities?country=${draft.country}`}>К городам страны</Link>
        </div>
      </aside>
    </form>
  );
}

/** «©» на фото, как у студента (план 4.4, контракт 2.5): «Фото: автор, источник, лицензия»; Escape закрывает. */
function PreviewCredit({ photo }: Readonly<{ photo: GeoPhoto }>) {
  const link = (href: string | null, label: string) => (href ? <a className="underline underline-offset-4" href={href} target="_blank" rel="noopener noreferrer">{label}<span className="sr-only"> (в новой вкладке)</span></a> : label);
  return (
    <details className="absolute end-2 top-2" data-testid="city-preview-credit" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
      <summary aria-label="Автор и лицензия фото" title="Автор и лицензия фото" className="grid size-8 cursor-pointer list-none place-items-center rounded-full bg-black/45 t-label text-white [&::-webkit-details-marker]:hidden"><span aria-hidden="true">©</span></summary>
      <p className="absolute end-0 top-10 z-10 w-64 rounded-ctl border border-border bg-surface p-3 t-meta text-fg shadow-evo-lg">
        Фото: {link(photo.authorUrl, photo.author)}, {link(photo.sourceUrl, photo.sourceName)}, {link(photo.licenseUrl, photo.license)}
      </p>
    </details>
  );
}

function Group({ title, note, children }: Readonly<{ title: string; note?: string; children: ReactNode }>) {
  return (
    <section className="space-y-3 rounded-card border border-border bg-surface p-4 sm:p-5">
      <h2 className="t-section text-fg">{title}</h2>
      {note ? <p className="t-meta text-fg-2">{note}</p> : null}
      {children}
    </section>
  );
}
