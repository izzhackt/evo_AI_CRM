"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import type { CountryChoiceSource } from "@/lib/portal/country-choice";
import { setStudentCountryChoiceAction } from "@/lib/portal/country-choice-actions";
import type { CountryTimelineView, TimelineStepProgress, TimelineViewStep } from "@/lib/portal/country-timeline";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import { JOURNEY_ANCHOR } from "@/lib/portal/journey-anchor";
import { journeyStrip } from "@/lib/portal/journey-strip";
import type { PlacePhoto } from "@/lib/portal/university-tiles";

import { PhotoRights, type PhotoRightsStrings } from "../universities/PhotoRights";
import { PlaceImage } from "../universities/PlaceImage";

/**
 * «Путь поступления» (S4, план §8.4; контракт docs/portal/country-timeline-contract.md
 * §3, §5 и §7). С 08.11.2026 стоит на «Поступлении» под якорем #path; с 18.11.2026 и на
 * «Главной» — свёрнутым, с её шапкой (проп `hero`) на фото столицы. Сервер уже выбрал и
 * локализовал путь (`selectCountryTimeline`): сюда приходит только он, без
 * всех файлов контента. Шаги раскрываются в пункты (только чтение, отметок
 * нет); раскрытые шаги помнит браузер, ключ с `file` и `contentVersion`.
 * Выбор страны пишет `set_student_country_choice_v1` через серверный экшен:
 * новый requestId на каждое действие, тот же при повторе после сбоя.
 */

export type CountryOption = Readonly<{ code: string; label: string }>;

type Strings = PortalStrings<"timeline">;

// ---------------------------------------------------------------------------
// Раскрытые шаги в localStorage. Хранилище может быть недоступно (приватное
// окно, запрет сайта): тогда состояние живёт в памяти вкладки, экран работает.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "evo.portal.timeline.open.v1";
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readStored(key: string): string {
  if (memory.has(key)) return memory.get(key) ?? "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Остаётся в памяти вкладки.
  }
  for (const listener of listeners) listener();
}

function subscribeStored(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(STORAGE_PREFIX)) {
      memory.delete(event.key);
      listener();
    }
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function parseOpen(raw: string, known: ReadonlySet<string>): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === "string" && known.has(id)));
  } catch {
    return new Set();
  }
}

function useOpenSteps(view: CountryTimelineView | null) {
  const key = view ? `${STORAGE_PREFIX}:${view.file}:${view.contentVersion}` : "";
  const raw = useSyncExternalStore(subscribeStored, () => (key ? readStored(key) : ""), () => "");
  const steps = view?.steps;
  const open = useMemo(
    () => parseOpen(raw, new Set((steps ?? []).map((step) => step.id))),
    [raw, steps],
  );
  const toggle = useCallback((id: string) => {
    if (!key) return;
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeStored(key, JSON.stringify([...next]));
  }, [key, open]);
  return { open, toggle };
}

// Свёрнут ли весь путь: выбор студента помнит браузер (`1` / `0`), без выбора — по умолчанию.
function useFolded(defaultFolded: boolean) {
  const key = `${STORAGE_PREFIX}:folded`;
  const raw = useSyncExternalStore(subscribeStored, () => readStored(key), () => "");
  const folded = raw === "1" ? true : raw === "0" ? false : defaultFolded;
  const setFolded = useCallback((value: boolean) => writeStored(key, value ? "1" : "0"), [key]);
  return { folded, setFolded };
}

// ---------------------------------------------------------------------------
// Значки: один штрих 1.5 на сетке 20, как в рейле кабинета.
// ---------------------------------------------------------------------------

function Icon({ path, className }: Readonly<{ path: string; className?: string }>) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICON = {
  calendar: "M4 5.5h12v10.5H4zM4 8.5h12M7 3.5v3M13 3.5v3",
  chevron: "M5.5 8l4.5 4.5L14.5 8",
  done: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM6.8 10.2l2.2 2.2 4.2-4.6",
  check: "M5 10.5l3.2 3.2L15 6.5",
  external: "M11.5 4.5h4v4M15.5 4.5L9 11M13.5 11.5v4h-9v-9h4",
  info: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9.2v4.3M10 6.6h.01",
} as const;

// ---------------------------------------------------------------------------

function StepPanel({ step, strings, panelId }: Readonly<{ step: TimelineViewStep; strings: Strings; panelId: string }>) {
  return (
    <div className="pt-step-panel-inner">
      <div className="pt-step-body">
        {step.note ? <p className="pt-step-note">{step.note}</p> : null}
        {step.items.length > 0 ? (
          <>
            <h4 className="pt-step-subhead" id={`${panelId}-list`}>{strings.checklist}</h4>
            <ul className="pt-step-items" aria-labelledby={`${panelId}-list`}>
              {step.items.map((item) => (
                <li key={item.id} className="pt-step-item" data-who={item.who}>
                  <span className="pt-step-who">{item.whoLabel}</span>
                  <div className="pt-step-item-body">
                    {item.appliesTo ? <p className="pt-step-applies">{item.appliesTo}</p> : null}
                    <p className="pt-step-item-text">{item.text}</p>
                    {item.note ? <p className="pt-step-item-note">{item.note}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {step.links.length > 0 ? (
          <ul className="pt-step-links">
            {step.links.map((link) => (
              <li key={link.id}>
                {link.external ? (
                  <a className="pt-link pt-step-link" href={link.href} target="_blank" rel="noopener noreferrer">
                    {link.label}
                    <Icon path={ICON.external} className="pt-step-link-icon" />
                    <span className="pt-sr-only"> ({strings.external})</span>
                  </a>
                ) : (
                  <IntentPrefetchLink className="pt-link pt-step-link" href={link.href}>
                    {link.label}
                  </IntentPrefetchLink>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="pt-step-done">
        <h4 className="pt-step-subhead pt-step-done-title">
          <Icon path={ICON.done} className="pt-step-done-icon" />
          {strings.doneWhen}
        </h4>
        <p className="pt-step-done-text">{step.doneWhen}</p>
      </div>
    </div>
  );
}

function CountryPicker({
  id,
  options,
  current,
  savingCode,
  busy,
  lead,
  strings,
  onChoose,
  onCancel,
}: Readonly<{
  id: string;
  options: readonly CountryOption[];
  current: string | null;
  savingCode: string | null;
  busy: boolean;
  lead: string | null;
  strings: Strings;
  onChoose: (code: string) => void;
  onCancel: (() => void) | null;
}>) {
  const labelId = `${id}-label`;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <div id={id} className="pt-journey-picker" role="group" aria-labelledby={labelId} onKeyDown={onKeyDown}>
      <p id={labelId} className={lead ? "pt-journey-picker-lead" : "pt-sr-only"}>
        {lead ? <span className="pt-sr-only">{strings.choiceGroup}. </span> : strings.choiceGroup}
        {lead}
      </p>
      <ul className="pt-journey-options">
        {options.map((option) => {
          const pressed = option.code === current;
          const saving = option.code === savingCode;
          return (
            <li key={option.code}>
              <button
                type="button"
                className="pt-journey-option"
                data-option={option.code}
                aria-pressed={pressed}
                aria-disabled={busy || undefined}
                data-saving={saving || undefined}
                onClick={() => onChoose(option.code)}
              >
                <span className="pt-journey-option-name">{option.label}</span>
                {saving ? (
                  <span className="pt-journey-option-mark">{strings.saving}</span>
                ) : pressed ? (
                  <span className="pt-journey-option-mark">
                    <Icon path={ICON.check} className="pt-journey-option-icon" />
                    {strings.current}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {onCancel ? (
        <button type="button" className="pt-btn-ghost pt-journey-cancel" onClick={onCancel}>
          {strings.cancelChange}
        </button>
      ) : null}
    </div>
  );
}

export function CountryTimeline({
  view,
  progress = null,
  documentsHref = null,
  source,
  readFailed,
  options,
  strings,
  photo = null,
  photoStrings = null,
  hero = null,
  stripStrings = null,
  stage = null,
}: Readonly<{
  /** Путь выбранной страны; `null`: выбора нет, показываем «Выберите страну». */
  view: CountryTimelineView | null;
  /** Прогресс по этапу дела (`timelineStepProgress`); `null`: без прогресса, как у студента без дела. */
  progress?: Readonly<Record<string, TimelineStepProgress>> | null;
  /** «Документы» кабинета, если студенту они открыты; текущий шаг этапа документов ведёт туда. */
  documentsHref?: string | null;
  /** Откуда выбор; `null`, если чтение выбора не удалось. */
  source: CountryChoiceSource | null;
  readFailed: boolean;
  /** Шесть стран и «Пока не решил» (код UNDECIDED), названия из study-countries.json. */
  options: readonly CountryOption[];
  strings: Strings;
  /**
   * Фото столицы страны (18.11.2026, «Главная»): фон шапки пути с автором по «©». Показывается, только пока страна
   * фото совпадает со страной пути; `null` — шапка без фото, как раньше.
   */
  photo?: Readonly<{ country: string; image: PlacePhoto }> | null;
  photoStrings?: PhotoRightsStrings | null;
  /**
   * Шапка «Главной» (приветствие, «страна · набор», отсчёт; 18.11.2026, пользователь: одна шапка на фото вместо двух
   * тёмных плашек). С ней шапка пути — это шапка страницы: название пути остаётся заголовком блока для читалки.
   */
  hero?: ReactNode;
  /**
   * Слова строки «Шаг N из M · дальше — …» и «Поступление завершено» (10.11.2026, владелец; `home.strip*`, общие с
   * iPhone). С 19.11.2026 их говорит строка под шапкой «Главной», как раньше карточка «Путь»; `null` — только название.
   */
  stripStrings?: Readonly<{ step: string; next: string; done: string }> | null;
  /** Этап дела (`operational_stage`): `completed` и `closed` — «Поступление завершено», как у `journeyStrip`. */
  stage?: string | null;
}>) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const pickerId = `${baseId}-picker`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const nowRef = useRef<HTMLDivElement>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [busy, startTransition] = useTransition();
  // Повтор после сбоя идёт с тем же requestId: RPC вернёт исходную квитанцию.
  const retry = useRef<{ country: string; requestId: string } | null>(null);

  const progressOf = (id: string): TimelineStepProgress | null => progress?.[id] ?? null;
  const doneSteps = view?.steps.filter((step) => progressOf(step.id) === "done") ?? [];
  const currentStep = view?.steps.find((step) => progressOf(step.id) === "current") ?? null;
  // Строка под шапкой: текущий шаг или «Поступление завершено» (это — только со словами `stripStrings`). Тот же счёт,
  // что у iPhone (`journeyStrip`): номер — `order` шага, всего — все шаги, «дальше» пропускает шаги «по желанию».
  // У завершённого или закрытого дела прогресса по шагам нет: строка говорит «завершено», полосы и отметок нет.
  const strip = view ? journeyStrip(view.steps, progress, stage) : null;
  const nowRow = strip?.kind === "step" && currentStep ? strip : strip?.kind === "complete" && stripStrings ? strip : null;
  const [showDone, setShowDone] = useState(false);
  const stepId = (id: string) => `${baseId}-step-${id}`;

  const { open, toggle } = useOpenSteps(view);
  // Без выбора студента путь свёрнут до шапки (18.11.2026, пользователь: на «Главной» — только компактная шапка);
  // с текущим шагом под шапкой ещё строка текущего шага. Раскрытый студентом путь запоминается.
  const { folded, setFolded } = useFolded(true);
  const stepsId = `${baseId}-steps`;

  // Переход «Весь путь» с карточки «Главной» (#path) — выбор студента увидеть весь путь: путь раскрыт и запомнен так.
  useEffect(() => {
    if (window.location.hash === `#${JOURNEY_ANCHOR}`) setFolded(false);
  }, [setFolded]);

  // Строка «Шаг N из M» над шагами: раскрывает путь и текущий шаг и прокручивает к нему.
  function jumpToCurrent() {
    if (!currentStep) return;
    if (folded) setFolded(false);
    if (!open.has(currentStep.id)) toggle(currentStep.id);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Шаги появляются после следующей отрисовки: прокрутка — после неё. Шаг встаёт под закреплённой строкой, а её
    // высота зависит от переноса названия и «дальше — …», поэтому отступ берётся из самой строки.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = document.getElementById(stepId(currentStep.id));
      const row = nowRef.current;
      if (target && row) {
        const top = Number.parseFloat(window.getComputedStyle(row).top) || 0;
        target.style.scrollMarginTop = `${top + row.offsetHeight + 12}px`;
      }
      target?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }));
  }

  const foldButton = (
    <button type="button" className="pt-journey-fold" aria-expanded={!folded} aria-controls={stepsId}
      onClick={() => setFolded(!folded)}>
      {folded ? strings.showSteps : strings.hideSteps}
      <Icon path={ICON.chevron} className="pt-journey-fold-icon" />
    </button>
  );

  const showPicker = view === null || pickerOpen;

  // Фокус: открытый выбор начинается с текущей страны; после сохранения фокус
  // переходит на заголовок блока, и читалка называет новую страну.
  useEffect(() => {
    if (!pickerOpen) return;
    const root = pickerWrapRef.current;
    const target = root?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?? root?.querySelector<HTMLButtonElement>(".pt-journey-option");
    target?.focus();
  }, [pickerOpen]);

  useEffect(() => {
    if (savedCount > 0) headingRef.current?.focus();
  }, [savedCount]);

  const closePicker = () => {
    setPickerOpen(false);
    setFailed(false);
    changeRef.current?.focus();
  };

  const choose = (code: string) => {
    if (busy) return;
    if (view && code === view.choice && source === "saved") {
      closePicker();
      return;
    }
    const requestId = retry.current?.country === code ? retry.current.requestId : crypto.randomUUID();
    retry.current = { country: code, requestId };
    setFailed(false);
    setSavingCode(code);
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await setStudentCountryChoiceAction(code, requestId)).ok;
      } catch {
        ok = false;
      }
      startTransition(() => {
        setSavingCode(null);
        if (ok) {
          retry.current = null;
          setPickerOpen(false);
          setSavedCount((count) => count + 1);
        } else {
          setFailed(true);
        }
      });
    });
  };

  const title = view
    ? view.countryName
      ? formatPortalString(strings.headingCountry, { country: view.countryName })
      : strings.heading
    : strings.chooseTitle;
  // Откуда страна. На шапке «Главной» подписи нет (19.11.2026, пользователь выбрал шапку без неё): её говорит выбор
  // страны, когда студент его открывает.
  const sourceNote = source === "application"
    ? strings.sourceApplication
    : source === "case"
      ? strings.sourceCase
      : null;
  // Фото — только своей страны: после смены страны до обновления страницы шапка идёт без фото.
  const headPhoto = view && photo && photo.country === view.choice ? photo.image : null;
  const timed = view?.steps.some((step) => step.timing !== null) ?? false;
  const total = view?.steps.length ?? 0;

  return (
    <section
      id={JOURNEY_ANCHOR}
      aria-labelledby={headingId}
      className="pt-card pt-journey"
      data-kind={view?.kind ?? "choose"}
      data-file={view?.file}
      data-ky-proofreading={view?.kyNeedsProofreading ? "pending" : undefined}
      aria-busy={busy || undefined}
    >
      {hero && view ? (
        <header className="pt-journey-head" data-hero="" data-photo={headPhoto ? "" : undefined}>
          {headPhoto ? (
            <div className="pt-journey-photo">
              <PlaceImage
                src={headPhoto.src}
                srcSet={headPhoto.srcSet}
                sizes="(min-width: 1100px) 1024px, 100vw"
                width={headPhoto.width}
                height={headPhoto.height}
                priority
                className="pt-journey-photo-img"
              />
            </div>
          ) : null}
          {hero}
          {/* Заголовок блока для читалки: путь страны под приветствием-h1. */}
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="pt-sr-only">{title}</h2>
          <div className="pt-journey-change">
            {nowRow ? null : foldButton}
            <button
              ref={changeRef}
              type="button"
              className="pt-btn-ghost"
              aria-expanded={pickerOpen}
              aria-controls={pickerOpen ? pickerId : undefined}
              onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
            >
              {strings.changeCountry}
            </button>
          </div>
          {headPhoto && photoStrings ? <PhotoRights credit={headPhoto.credit} strings={photoStrings} placement="bottom" /> : null}
        </header>
      ) : (
      <header className="pt-journey-head" data-photo={headPhoto ? "" : undefined}>
        {headPhoto ? (
          <div className="pt-journey-photo">
            <PlaceImage
              src={headPhoto.src}
              srcSet={headPhoto.srcSet}
              sizes="(min-width: 1100px) 1024px, 100vw"
              width={headPhoto.width}
              height={headPhoto.height}
              className="pt-journey-photo-img"
            />
          </div>
        ) : null}
        {headPhoto && photoStrings ? <PhotoRights credit={headPhoto.credit} strings={photoStrings} placement="top" /> : null}
        <div className="pt-journey-head-main">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="pt-journey-title">{title}</h2>
          {view ? (
            <>
              <p className="pt-journey-intake">
                <Icon path={ICON.calendar} className="pt-journey-intake-icon" />
                <span>{view.intake.label}</span>
              </p>
              {view.intake.note ? <p className="pt-journey-intake-note">{view.intake.note}</p> : null}
            </>
          ) : (
            <p className="pt-journey-intake-note">{strings.chooseLead}</p>
          )}
        </div>
        {view ? (
          <div className="pt-journey-change">
            {/* Без строки под шапкой «Все шаги» стоит в шапке рядом со сменой страны, а не одна внизу (перенесено из #1423, Айвар). */}
            {nowRow ? null : foldButton}
            <button
              ref={changeRef}
              type="button"
              className="pt-btn-ghost"
              aria-expanded={pickerOpen}
              aria-controls={pickerOpen ? pickerId : undefined}
              onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
            >
              {strings.changeCountry}
            </button>
            {sourceNote ? <p className="pt-journey-source">{sourceNote}</p> : null}
          </div>
        ) : null}
      </header>
      )}

      <p role="status" className="pt-sr-only">{busy ? strings.saving : ""}</p>
      {readFailed ? <p role="alert" className="pt-journey-alert">{strings.readError}</p> : null}

      {showPicker ? (
        <div ref={pickerWrapRef} className="pt-journey-picker-wrap" data-mode={view ? "change" : "choose"}>
          <CountryPicker
            id={pickerId}
            options={options}
            current={view?.choice ?? null}
            savingCode={savingCode}
            busy={busy}
            lead={view ? (hero && sourceNote ? `${sourceNote} ${strings.changeLead}` : strings.changeLead) : null}
            strings={strings}
            onChoose={choose}
            onCancel={view ? closePicker : null}
          />
          {failed ? <p role="alert" className="pt-journey-alert">{strings.saveError}</p> : null}
        </div>
      ) : null}

      {view ? (
        <>
          {/* Текущий шаг всегда на виду при прокрутке пути (08.11.2026, владелец). 19.11.2026 (пользователь: строку
              улучшить): круг с номером шага, название, «Шаг N из M · дальше — …», полоса шагов и в её конце «Все шаги».
              Число шагов прежде спорило с этапами дела в шапке «Главной»; этапов там больше нет (10.11.2026). */}
          {nowRow ? (
            <div ref={nowRef} className="pt-journey-now" role="group" aria-label={strings.whereNow} data-state={nowRow.kind}>
              {nowRow.kind === "step" ? (
                <button type="button" className="pt-journey-now-step" onClick={jumpToCurrent}>
                  <span className="pt-journey-now-node" aria-hidden="true">{nowRow.n}</span>
                  <span className="pt-journey-now-text">
                    <span className="pt-journey-now-title">{nowRow.title}</span>
                    {stripStrings ? (
                      <span className="pt-journey-now-sub">
                        <span className="pt-sr-only">. </span>
                        {formatPortalString(stripStrings.step, { n: String(nowRow.n), total: String(nowRow.total) })}
                        {nowRow.nextTitle ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="pt-sr-only">, </span>
                            {formatPortalString(stripStrings.next, { title: nowRow.nextTitle })}
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <span className="pt-sr-only">
                        {" "}{formatPortalString(strings.stepOf, { n: String(nowRow.n), total: String(nowRow.total) })}
                      </span>
                    )}
                  </span>
                </button>
              ) : (
                <p className="pt-journey-now-step">
                  <span className="pt-journey-now-node" aria-hidden="true">
                    <Icon path={ICON.check} className="pt-journey-now-check" />
                  </span>
                  <span className="pt-journey-now-title">{stripStrings?.done}</span>
                </p>
              )}
              <div className="pt-journey-now-bar">
                {/* Полоса шагов — картинка к строке выше по тем же отметкам, что у шагов; читалка слышит «Шаг N из M» в
                    самой строке. Нет отметок (дело завершено или закрыто) — нет и полосы. */}
                {progress ? (
                  <span className="pt-journey-meter" aria-hidden="true">
                    {view.steps.filter((step) => progressOf(step.id) !== "optional").map((step) => (
                      <span key={step.id} className="pt-journey-meter-seg" data-progress={progressOf(step.id) ?? "upcoming"} />
                    ))}
                  </span>
                ) : null}
                {foldButton}
              </div>
            </div>
          ) : null}
          {/* Весь путь сворачивается (08.11.2026, пользователь): шаги и «Важно знать» — по «Все шаги». */}
          <div id={stepsId} className="pt-journey-body" hidden={folded}>
          {/* В шапке-приветствии места под пояснение срока нет: оно открывается вместе с шагами. */}
          {hero && view.intake.note ? <p className="pt-journey-intake-note pt-journey-body-note">{view.intake.note}</p> : null}
          <ol className="pt-journey-steps" aria-label={strings.stepsLabel} data-timed={timed ? "true" : "false"}>
            {/* Пройденные шаги свёрнуты в одну строку; раскрываются по нажатию. */}
            {doneSteps.length > 0 ? (
              <li className="pt-step-done-group">
                <button
                  type="button"
                  className="pt-step-done-toggle"
                  aria-expanded={showDone}
                  aria-controls={doneSteps.map((step) => stepId(step.id)).join(" ")}
                  onClick={() => setShowDone((shown) => !shown)}
                >
                  <span className="pt-step-node" aria-hidden="true"><Icon path={ICON.check} className="pt-step-node-check" /></span>
                  {/* Одна строка: «Пройдено» и что именно — без раскрытия. */}
                  <span className="pt-step-done-text">
                    <span className="pt-step-done-count">{strings.showDone}</span>
                    <span className="pt-step-done-titles">{doneSteps.map((step) => step.title).join(" · ")}</span>
                  </span>
                  <Icon path={ICON.chevron} className="pt-step-chevron" />
                </button>
              </li>
            ) : null}
            {view.steps.map((step) => {
              const expanded = open.has(step.id);
              const panelId = `${baseId}-${step.id}`;
              const periodId = `${panelId}-period`;
              const state = progressOf(step.id);
              return (
                <li key={step.id} id={stepId(step.id)} className="pt-step" data-open={expanded ? "true" : "false"}
                  data-progress={state ?? undefined} hidden={state === "done" && !showDone}>
                  <div className="pt-step-head">
                    <span className="pt-step-node" aria-hidden="true">
                      {state === "done" ? <Icon path={ICON.check} className="pt-step-node-check" /> : step.order}
                    </span>
                    <div className="pt-step-main">
                      <h3 className="pt-step-title">
                        <button
                          type="button"
                          className="pt-step-toggle"
                          aria-expanded={expanded}
                          aria-controls={panelId}
                          aria-describedby={step.timing ? periodId : undefined}
                          onClick={() => toggle(step.id)}
                        >
                          <span className="pt-sr-only">
                            {formatPortalString(strings.stepOf, { n: String(step.order), total: String(total) })}{" "}
                          </span>
                          {step.title}
                        </button>
                        {/* Один знак «Сейчас» на экран: у текущего шага это строка «Сейчас: …» сверху и тёмный круг,
                            значка рядом с названием нет (08.11.2026); читалке слово остаётся. */}
                        {state === "done" ? (
                          <span className="pt-step-state" data-progress={state}>{strings.progressDone}</span>
                        ) : state === "current" ? (
                          <span className="pt-sr-only"> ({strings.progressCurrent})</span>
                        ) : state === "optional" ? (
                          <span className="pt-step-state" data-progress={state}>{strings.progressOptional}</span>
                        ) : null}
                      </h3>
                      <p className="pt-step-goal">{step.summary}</p>
                      {state === "current" && documentsHref && step.stageKeys.includes("documents") ? (
                        <p className="pt-step-go">
                          <IntentPrefetchLink className="pt-link" href={documentsHref}>{strings.openDocuments}</IntentPrefetchLink>
                        </p>
                      ) : null}
                    </div>
                    {step.timing ? (
                      <p id={periodId} className="pt-step-period">
                        <Icon path={ICON.calendar} className="pt-step-period-icon" />
                        <span>
                          <span className="pt-sr-only">{strings.period} </span>
                          {step.timing}
                        </span>
                      </p>
                    ) : null}
                    <Icon path={ICON.chevron} className="pt-step-chevron" />
                  </div>
                  <div id={panelId} className="pt-step-panel" hidden={!expanded}>
                    {expanded ? <StepPanel step={step} strings={strings} panelId={panelId} /> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="pt-journey-notes">
            <h3 className="pt-journey-notes-title">
              <Icon path={ICON.info} className="pt-journey-notes-icon" />
              {strings.notesLabel}
            </h3>
            <ul className="pt-journey-notes-list">
              {view.disclaimers.map((text) => <li key={text}>{text}</li>)}
            </ul>
          </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
