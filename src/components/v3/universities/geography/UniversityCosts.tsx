"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import {
  COST_CURRENCIES, COST_KINDS, COST_KIND_LABELS, COST_PERIODS, COST_PERIOD_LABELS, COST_SOURCE_KINDS, COST_SOURCE_LABELS, COST_STATUS_LABELS,
  TEACHING_LANGUAGES, catalogTextIssue, costDraft, costDraftChanged, costDraftNotes, costInput, costWhat, formatCostAmount, rateIsStale, usdApprox,
  type CostDraft, type CostField, type CostStatus, type GeoCost, type GeoFxRate,
} from "@/lib/catalog-geography";
import { UNIVERSITY_LEVELS, UNIVERSITY_LEVEL_LABELS, type UniversityLevel } from "@/lib/platform-university-catalog";

import { AREA, BusyLabel, CommandResult, DARK, FIELD, FieldError, GHOST, LABEL, QUIET, ReplacedDraft, focusFirstInvalid, useGeographyCommand, useVersionedDraft } from "./command";

/*
 * «Стоимость» в карточке вуза (план 7.5, контракт 3.3): строки с источником,
 * подтверждение строк агентств (только системный Admin) и публикация. Студент
 * видит только опубликованные строки; нет ни одной, нет и блока у студента.
 * Таблица на волосяных линиях, как «Программы и наборы»: от 56rem своей
 * ширины строка, уже стопка с подписями у значений.
 */
type Program = Readonly<{ id: string; title: string; level: UniversityLevel }>;
const GRID = "grid grid-cols-1 gap-x-3 gap-y-1 @min-[56rem]/costs:grid-cols-[minmax(0,24fr)_minmax(0,9fr)_minmax(0,16fr)_minmax(0,8fr)_minmax(0,19fr)_minmax(0,24fr)] @min-[56rem]/costs:items-baseline";
const HEAD = "t-caption text-start text-fg-2";
const COLUMNS = ["Что", "Период", "Сумма", "≈ USD", "Источник", "Состояние"] as const;
const DATE = "font-mono tabular-nums";
const dayText = (value: string) => value.split("-").reverse().join(".");
/** Слова владельца 16.10.2026 о данных агентств (контракт 3.4); Admin может уточнить основание. */
export const OWNER_AGENCY_CONFIRMATION = "Владелец подтвердил данные агентств в чате 16.10.2026: «у них правильно, мы все подтверждаем»";

function StackLabel({ children }: Readonly<{ children: string }>) {
  return <span className="me-1.5 t-caption text-fg-3 @min-[56rem]/costs:sr-only">{children}:</span>;
}

export function UniversityCosts({ institutionId, country, programs, costs, rates, canConfirm, today }: Readonly<{
  institutionId: string; country: string; programs: readonly Program[]; costs: readonly GeoCost[]; rates: readonly GeoFxRate[]; canConfirm: boolean; today: string;
}>) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const latest = new Map(rates.filter((rate) => rate.latest).map((rate) => [rate.currency, rate]));
  const currencies = [...new Set(costs.map((row) => row.currency))].filter((code) => code !== "USD").sort();
  const published = costs.filter((row) => row.status === "published").length;
  const titles = new Map(programs.map((program) => [program.id, program.title]));
  const order: Record<CostStatus, number> = { published: 0, draft: 1, retired: 2 };
  const rows = [...costs].sort((a, b) => order[a.status] - order[b.status] || COST_KINDS.indexOf(a.costKind) - COST_KINDS.indexOf(b.costKind));
  return (
    <section aria-labelledby="university-costs-heading" className="@container/costs space-y-3" data-testid="university-costs">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="university-costs-heading" className="t-section text-fg">Стоимость</h2>
          <p className="t-meta text-fg-2">
            {costs.length ? <>Студенты видят <span className="tabular-nums">{published}</span> из <span className="tabular-nums">{costs.length}</span></> : "Строк пока нет"}
            {published === 0 ? " · блока «Стоимость» у студента нет" : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4">
          <Link className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg" href="/v3/universities/rates">Курсы валют</Link>
          {editing === "new" ? null : <button type="button" className={GHOST} onClick={() => { setEditing("new"); setConfirming(null); }}><Icon name="plus" size={16} />Добавить строку</button>}
        </div>
      </div>
      <RateNotes currencies={currencies} latest={latest} />
      {editing === "new" ? <CostEditor key="new" row={null} institutionId={institutionId} country={country} programs={programs} canConfirm={canConfirm} today={today} onDone={() => setEditing(null)} /> : null}
      {rows.length ? (
        <table role="table" className="block w-full" data-testid="university-costs-table">
          <caption className="sr-only">Строки стоимости вуза: сначала те, что видят студенты</caption>
          <thead role="rowgroup" className="sr-only @min-[56rem]/costs:not-sr-only @min-[56rem]/costs:block">
            <tr role="row" className={`${GRID} border-b border-border pb-1.5`}>
              {COLUMNS.map((label) => <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>)}
            </tr>
          </thead>
          <tbody role="rowgroup" className="block">
            {rows.map((row) => editing === row.id ? (
              // Ключ без версии: после сохранения редактор сам закрывается, а не открывается заново;
              // новую версию строки при открытом редакторе разбирает useVersionedDraft (review CRM S1).
              <tr key={`${row.id}:edit`} role="row" className="block border-b border-border py-3">
                <td role="cell" className="block"><CostEditor row={row} institutionId={institutionId} country={country} programs={programs} canConfirm={canConfirm} today={today} onDone={() => setEditing(null)} /></td>
              </tr>
            ) : (
              <CostRow
                key={`${row.id}:${row.version}`}
                row={row}
                programTitle={row.programId ? titles.get(row.programId) ?? `программа ${row.programId}` : null}
                rate={latest.get(row.currency) ?? null}
                canConfirm={canConfirm}
                confirming={confirming === row.id && row.confirmedOn === null}
                onEdit={() => { setEditing(row.id); setConfirming(null); }}
                onConfirm={(open) => setConfirming(open ? row.id : null)}
              />
            ))}
          </tbody>
        </table>
      ) : editing === "new" ? null : (
        <p className="rounded-card border border-border bg-surface px-4 py-5 t-body-compact text-fg-2">
          Строк стоимости нет. Добавьте строку с источником и опубликуйте её.
        </p>
      )}
    </section>
  );
}

/** Курсы валют строк: нет курса или курс старше 45 дней. Исправный курс не подписывается. */
function RateNotes({ currencies, latest }: Readonly<{ currencies: readonly string[]; latest: ReadonlyMap<string, GeoFxRate> }>) {
  const notes = currencies.flatMap((code) => {
    const rate = latest.get(code);
    if (!rate) return [`Нет курса ${code}: студенты видят сумму в ${code} без ориентира в USD.`];
    return rateIsStale(rate) ? [`Курс ${code} от ${dayText(rate.asOf)} старше 45 дней (${rate.ageDays} дн.): ориентир в USD считается по нему.`] : [];
  });
  if (!notes.length) return null;
  return (
    <div role="status" className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card bg-warn-weak px-4 py-2.5 text-warn" data-testid="university-costs-rate-notes">
      <Icon name="alert" size={18} className="mt-0.5 flex-none" />
      <ul className="min-w-0 flex-1 space-y-0.5">{notes.map((note) => <li key={note} className="t-body-compact">{note}</li>)}</ul>
      <Link className="inline-flex min-h-11 items-center t-label underline underline-offset-4" href="/v3/universities/rates">Внести курс</Link>
    </div>
  );
}

function CostRow({ row, programTitle, rate, canConfirm, confirming, onEdit, onConfirm }: Readonly<{
  row: GeoCost; programTitle: string | null; rate: GeoFxRate | null; canConfirm: boolean; confirming: boolean; onEdit: () => void; onConfirm: (open: boolean) => void;
}>) {
  const publish = useGeographyCommand("cost_publish");
  const min = usdApprox(row.amountMinMinor, row.currency, row.exponent, rate?.unitsPerUsd ?? null);
  const max = row.amountMaxMinor === null ? null : usdApprox(row.amountMaxMinor, row.currency, row.exponent, rate?.unitsPerUsd ?? null);
  const usd = min === null ? null : max === null ? `≈ ${min.toLocaleString("ru-RU")}` : `≈ от ${min.toLocaleString("ru-RU")} до ${max.toLocaleString("ru-RU")}`;
  const agency = row.sourceKind === "agency", confirmed = row.confirmedOn !== null;
  const blocked = agency && !confirmed;
  const next: { status: CostStatus; label: string } = row.status === "published" ? { status: "retired", label: "Снять с публикации" } : { status: "published", label: row.status === "retired" ? "Опубликовать снова" : "Опубликовать" };
  const statusTone = row.status === "published" ? "ok" : "neutral";
  return (
    <>
      <tr role="row" className={`${GRID} border-b border-border py-2.5 ${confirming ? "border-b-0" : ""}`} data-cost-row={row.id} data-cost-status={row.status}>
        <th role="rowheader" scope="row" className="min-w-0 text-start font-normal">
          <span className="block t-body-compact font-medium text-fg">{costWhat(row, programTitle)}</span>
          {row.noteRu ? <span className="block t-meta text-fg-2">{row.noteRu}</span> : null}
        </th>
        <td role="cell" className="t-body-compact text-fg"><StackLabel>Период</StackLabel>{COST_PERIOD_LABELS[row.period]}</td>
        <td role="cell" className="t-body-compact text-fg">
          <StackLabel>Сумма</StackLabel><span className="tabular-nums">{formatCostAmount(row)}</span>
          <span className="block t-meta text-fg-3">{row.academicYear ? `Год: ${row.academicYear}` : "Год в источнике не указан"}</span>
        </td>
        <td role="cell" className="t-body-compact text-fg-2">
          <StackLabel>В USD</StackLabel>{usd ? <span className="tabular-nums">{usd}</span> : <span className="text-fg-3">{row.currency === "USD" ? "в USD" : "нет курса"}</span>}
        </td>
        <td role="cell" className="min-w-0 t-body-compact text-fg-2">
          <StackLabel>Источник</StackLabel>
          <span className="text-fg">{COST_SOURCE_LABELS[row.sourceKind]}</span>{" · "}
          {row.sourceUrl ? <a className="underline underline-offset-4 [overflow-wrap:anywhere] hover:text-fg" href={row.sourceUrl} target="_blank" rel="noopener noreferrer">{row.sourceName}<span className="sr-only"> (в новой вкладке)</span></a> : row.sourceName}
          <span className="block t-meta text-fg-3">Проверено <time className={DATE} dateTime={row.verifiedOn}>{dayText(row.verifiedOn)}</time></span>
        </td>
        <td role="cell" className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusChip label={COST_STATUS_LABELS[row.status]} tone={statusTone} />
            {agency ? <StatusChip label={confirmed ? `Подтверждена ${dayText(row.confirmedOn!)}` : "Не подтверждена"} tone={confirmed ? "neutral" : "warn"} title={row.confirmationReason ?? undefined} /> : null}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-4">
            <button type="button" className={QUIET} onClick={onEdit} disabled={publish.pending}>Изменить</button>
            {blocked && canConfirm ? <button type="button" className={QUIET} onClick={() => onConfirm(!confirming)} aria-expanded={confirming}>Подтвердить</button> : null}
            {blocked && next.status === "published" ? (
              canConfirm ? null : <span className="t-meta text-fg-3">Публикация после подтверждения Admin</span>
            ) : (
              <button type="button" className={QUIET} disabled={publish.pending} onClick={() => publish.run({ costId: row.id, status: next.status, baseVersion: row.version })}>
                <BusyLabel busy={publish.pending} label={next.label} />
              </button>
            )}
          </span>
          <CommandResult state={publish.state} refresh={publish.refresh} />
        </td>
      </tr>
      {confirming ? (
        <tr role="row" className="block border-b border-border pb-3">
          <td role="cell" className="block"><ConfirmAgency row={row} onCancel={() => onConfirm(false)} /></td>
        </tr>
      ) : null}
    </>
  );
}

/** Подтверждение данных агентства (только системный Admin): основание видно только сотрудникам. Не публикует. */
function ConfirmAgency({ row, onCancel }: Readonly<{ row: GeoCost; onCancel: () => void }>) {
  const [reason, setReason] = useState(OWNER_AGENCY_CONFIRMATION);
  const { state, run, pending, refresh } = useGeographyCommand("cost_confirm");
  const id = useId();
  // Основание по правилу текстов базы (catalog_text_ok, до 500 знаков).
  const issue = catalogTextIssue(reason.trim(), 500, false);
  const valid = issue === null;
  return (
    <form className="space-y-3 rounded-card border border-border bg-surface-2 p-4" onSubmit={(event) => { event.preventDefault(); if (valid) run({ costId: row.id, baseVersion: row.version, reason: reason.trim() }); }} data-testid="cost-confirm-form">
      <p className="t-body-compact text-fg">Данные агентства «{row.sourceName}» для студентов будут подписаны как «открытые данные образовательных агентств», без названия агентства. Подтверждение не публикует строку.</p>
      <label className={LABEL} htmlFor={`${id}-reason`}>Основание подтверждения</label>
      <textarea id={`${id}-reason`} className={AREA} value={reason} maxLength={520} rows={2} disabled={pending} onChange={(event) => setReason(event.target.value.replace(/[\r\n]+/g, " "))} aria-invalid={!valid} aria-describedby={issue ? `${id}-reason-error` : undefined} />
      <FieldError id={`${id}-reason-error`} text={issue} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={DARK} disabled={pending || !valid}><BusyLabel busy={pending} label="Подтвердить данные агентства" busyLabel="Подтверждаем…" /></button>
        <button type="button" className={GHOST} onClick={onCancel} disabled={pending}>Отмена</button>
      </div>
      <CommandResult state={state} refresh={refresh} />
    </form>
  );
}

const FIELD_ERRORS: Readonly<Partial<Record<CostField, string>>> = {
  programId: "Программы нет в опубликованной карточке.",
  amountMin: "Сумма числом, не больше двух знаков после запятой.",
  amountMax: "Сумма «до» больше суммы «от» или пусто.",
  academicYear: "Например 2026/27 или 2026; пусто, если источник год не называет.",
  note: "Пояснение на двух языках или ни одного, до 300 знаков.",
  sourceName: "Название источника, до 200 знаков.",
  sourceUrl: "Адрес https:// обязателен для сайта университета и агентства.",
  sourceKind: "Выберите вид источника.",
  verifiedOn: "Дата проверки не позже сегодняшней.",
  currency: "Три латинские буквы ISO 4217.",
};

function CostEditor({ row, institutionId, country, programs, canConfirm, today, onDone }: Readonly<{
  row: GeoCost | null; institutionId: string; country: string; programs: readonly Program[]; canConfirm: boolean; today: string; onDone: () => void;
}>) {
  const { state, run, pending, refresh, dismiss } = useGeographyCommand("cost_upsert");
  // Черновик помнит версию строки, от которой начат: сохранение отправляет её (review CRM S1).
  const versioned = useVersionedDraft(row, {
    draft: (value) => costDraft(value, country, today),
    changed: (value, saved) => costDraftChanged(value, saved, country, programs, today),
    notes: (value, base) => costDraftNotes(value, base, country, today),
  }, state);
  const { draft, setDraft } = versioned;
  const [shown, setShown] = useState(false);
  const id = useId();
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => { if (state.status === "saved") done.current(); }, [state]);
  const { input, errors } = costInput(draft, { id: row?.id ?? null, institutionId }, programs, today);
  const set = <K extends keyof CostDraft>(key: K, value: CostDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const error = (field: CostField) => (shown && errors.has(field) ? errors.get(field) ?? FIELD_ERRORS[field] ?? "Проверьте поле." : null);
  const invalid = (field: CostField) => (shown && errors.has(field) ? true : undefined);
  const program = programs.find((item) => item.id === draft.programId) ?? null;
  const currencies: readonly string[] = COST_CURRENCIES.includes(draft.currency as never) ? COST_CURRENCIES : [...COST_CURRENCIES, draft.currency];
  const resets = row !== null && (row.status !== "draft" || row.confirmedOn !== null);
  // Вид источника строки агентства меняет только системный Admin (283, review CRM R4).
  const kindLocked = row?.sourceKind === "agency" && !canConfirm;
  const field = (name: CostField) => ({ id: `${id}-${name}`, "aria-invalid": invalid(name), "aria-describedby": error(name) ? `${id}-${name}-error` : undefined });
  return (
    <form
      className="space-y-4 rounded-card border border-border bg-surface p-4"
      data-testid="cost-editor"
      noValidate
      onSubmit={(event) => { event.preventDefault(); setShown(true); if (errors.size === 0 && !versioned.behind) { versioned.closeReplaced(); run({ cost: input, baseVersion: versioned.baseVersion }); } else focusFirstInvalid(event.currentTarget); }}
      aria-busy={pending}
    >
      <h3 className="t-item text-fg">{row ? "Изменить строку стоимости" : "Новая строка стоимости"}</h3>
      {resets ? <p className="t-body-compact text-warn">После сохранения строка станет черновиком: студенты не увидят её, пока её снова не опубликуют{row?.confirmedOn ? ". Подтверждение агентства снимется, и опубликовать строку можно будет только после нового подтверждения системного Admin" : ""}.</p> : null}
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Строка стоимости</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className={LABEL}>Что<select className={FIELD} value={draft.costKind} onChange={(event) => set("costKind", event.target.value as CostDraft["costKind"])}>{COST_KINDS.map((kind) => <option key={kind} value={kind}>{COST_KIND_LABELS[kind]}</option>)}</select></label>
          <label className={LABEL}>Период<select className={FIELD} value={draft.period} onChange={(event) => set("period", event.target.value as CostDraft["period"])}>{COST_PERIODS.map((period) => <option key={period} value={period}>{COST_PERIOD_LABELS[period]}</option>)}</select></label>
          <label className={LABEL}>Программа<select className={FIELD} value={draft.programId} {...field("programId")} onChange={(event) => { const chosen = programs.find((item) => item.id === event.target.value); setDraft((current) => ({ ...current, programId: event.target.value, studyLevel: chosen ? chosen.level : current.studyLevel })); }}>
            <option value="">Весь вуз</option>
            {programs.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            {draft.programId && !program ? <option value={draft.programId}>Нет в карточке: {draft.programId}</option> : null}
          </select><FieldError id={`${id}-programId-error`} text={error("programId")} /></label>
          <label className={LABEL}>Уровень<select className={FIELD} value={program ? program.level : draft.studyLevel} disabled={program !== null} onChange={(event) => set("studyLevel", event.target.value)}>
            <option value="">Все уровни</option>
            {UNIVERSITY_LEVELS.map((level) => <option key={level} value={level}>{UNIVERSITY_LEVEL_LABELS[level]}</option>)}
          </select></label>
          <label className={LABEL}>Язык обучения<select className={FIELD} value={draft.teachingLanguage} onChange={(event) => set("teachingLanguage", event.target.value)}>
            <option value="">Не указан</option>
            {Object.entries(TEACHING_LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            {draft.teachingLanguage && !TEACHING_LANGUAGES[draft.teachingLanguage] ? <option value={draft.teachingLanguage}>{draft.teachingLanguage}</option> : null}
          </select></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={LABEL}>Валюта вуза<select className={FIELD} value={draft.currency} {...field("currency")} onChange={(event) => set("currency", event.target.value)}>{currencies.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
          <label className={LABEL}>Сумма или «от»<input className={`${FIELD} tabular-nums`} inputMode="decimal" value={draft.amountMin} {...field("amountMin")} onChange={(event) => set("amountMin", event.target.value)} required /><FieldError id={`${id}-amountMin-error`} text={error("amountMin")} /></label>
          <label className={LABEL}>«До», если диапазон<input className={`${FIELD} tabular-nums`} inputMode="decimal" value={draft.amountMax} {...field("amountMax")} onChange={(event) => set("amountMax", event.target.value)} /><FieldError id={`${id}-amountMax-error`} text={error("amountMax")} /></label>
          <label className={LABEL}>Учебный год, если в источнике<input className={FIELD} value={draft.academicYear} placeholder="например, 2026/27" maxLength={7} {...field("academicYear")} onChange={(event) => set("academicYear", event.target.value)} /><FieldError id={`${id}-academicYear-error`} text={error("academicYear")} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>Пояснение студенту, RU<textarea className={AREA} rows={2} maxLength={300} value={draft.noteRu} aria-invalid={invalid("note")} onChange={(event) => set("noteRu", event.target.value.replace(/[\r\n]+/g, " "))} /></label>
          <label className={LABEL}>Пояснение студенту, KY<textarea className={AREA} rows={2} maxLength={300} value={draft.noteKy} aria-invalid={invalid("note")} onChange={(event) => set("noteKy", event.target.value.replace(/[\r\n]+/g, " "))} /></label>
        </div>
        <FieldError id={`${id}-note-error`} text={error("note")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          <label className={LABEL}>Источник
            <select className={FIELD} value={draft.sourceKind} disabled={kindLocked} {...field("sourceKind")} aria-describedby={[error("sourceKind") ? `${id}-sourceKind-error` : null, kindLocked ? `${id}-sourceKind-locked` : null].filter(Boolean).join(" ") || undefined} onChange={(event) => set("sourceKind", event.target.value as CostDraft["sourceKind"])}>{COST_SOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{COST_SOURCE_LABELS[kind]}</option>)}</select>
            <FieldError id={`${id}-sourceKind-error`} text={error("sourceKind")} />
            {kindLocked ? <span id={`${id}-sourceKind-locked`} className="mt-1 block t-meta text-fg-3">Вид источника строки агентства меняет только системный Admin.</span> : null}
          </label>
          <label className={LABEL}>Название источника<input className={FIELD} value={draft.sourceName} maxLength={200} {...field("sourceName")} onChange={(event) => set("sourceName", event.target.value)} required /><FieldError id={`${id}-sourceName-error`} text={error("sourceName")} /></label>
          <label className={LABEL}>Адрес источника (https)<input className={FIELD} type="url" value={draft.sourceUrl} maxLength={1000} {...field("sourceUrl")} onChange={(event) => set("sourceUrl", event.target.value)} /><FieldError id={`${id}-sourceUrl-error`} text={error("sourceUrl")} /></label>
          <label className={LABEL}>Проверено<input className={`${FIELD} font-mono`} type="date" max={today} value={draft.verifiedOn} {...field("verifiedOn")} onChange={(event) => set("verifiedOn", event.target.value)} required /><FieldError id={`${id}-verifiedOn-error`} text={error("verifiedOn")} /></label>
        </div>
        {draft.sourceKind === "agency" ? <p className="t-meta text-fg-2">Название и адрес агентства видят только сотрудники. Опубликовать строку агентства можно после подтверждения системного Admin.</p> : null}
      </fieldset>
      {/* Кнопки над итогами и одного размера во время запроса: появление и уход сообщений их не сдвигают (review CRM V2). */}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={DARK} disabled={pending || versioned.behind}><BusyLabel busy={pending} label={state.status === "unavailable" ? "Повторить" : "Сохранить черновиком"} /></button>
        <button type="button" className={GHOST} onClick={onDone} disabled={pending}>Отмена</button>
      </div>
      {shown && errors.size ? <p role="alert" className="t-body-compact text-danger">Исправьте отмеченные поля: строка не сохранена.</p> : null}
      {versioned.behind && row ? (
        <p role="status" className="flex flex-wrap items-center gap-x-3 t-body-compact text-warn" data-testid="cost-behind">
          Строку изменили, пока вы её правили: сохранена версия {row.version}, ваша правка начата с версии {versioned.baseVersion}. Сохранить поверх нельзя.
          <button type="button" className={QUIET} onClick={versioned.showSaved}>Показать сохранённую строку</button>
        </p>
      ) : null}
      {versioned.reloading ? <p role="status" className="t-body-compact text-fg-2">Загружаем сохранённую строку…</p> : null}
      {versioned.replaced ? <ReplacedDraft replaced={versioned.replaced} onClose={versioned.closeReplaced} /> : null}
      <CommandResult state={state} refresh={() => { dismiss(); versioned.reload(refresh); }} />
    </form>
  );
}
