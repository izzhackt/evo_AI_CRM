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
} from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import type { CountryChoiceSource } from "@/lib/portal/country-choice";
import { setStudentCountryChoiceAction } from "@/lib/portal/country-choice-actions";
import type { CountryTimelineView, TimelineViewStep } from "@/lib/portal/country-timeline";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

/**
 * «Путь поступления» на «Главной» (S4, план §8.4; контракт
 * docs/portal/country-timeline-contract.md §3 и §5). Сервер уже выбрал и
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
  source,
  readFailed,
  options,
  strings,
}: Readonly<{
  /** Путь выбранной страны; `null`: выбора нет, показываем «Выберите страну». */
  view: CountryTimelineView | null;
  /** Откуда выбор; `null`, если чтение выбора не удалось. */
  source: CountryChoiceSource | null;
  readFailed: boolean;
  /** Шесть стран и «Пока не решил» (код UNDECIDED), названия из study-countries.json. */
  options: readonly CountryOption[];
  strings: Strings;
}>) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const pickerId = `${baseId}-picker`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const pickerWrapRef = useRef<HTMLDivElement>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [busy, startTransition] = useTransition();
  // Повтор после сбоя идёт с тем же requestId: RPC вернёт исходную квитанцию.
  const retry = useRef<{ country: string; requestId: string } | null>(null);

  const { open, toggle } = useOpenSteps(view);

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
  const sourceNote = source === "application"
    ? strings.sourceApplication
    : source === "case"
      ? strings.sourceCase
      : null;
  const timed = view?.steps.some((step) => step.timing !== null) ?? false;
  const total = view?.steps.length ?? 0;

  return (
    <section
      aria-labelledby={headingId}
      className="pt-card pt-journey"
      data-kind={view?.kind ?? "choose"}
      data-file={view?.file}
      data-ky-proofreading={view?.kyNeedsProofreading ? "pending" : undefined}
      aria-busy={busy || undefined}
    >
      <header className="pt-journey-head">
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
            lead={view ? strings.changeLead : null}
            strings={strings}
            onChoose={choose}
            onCancel={view ? closePicker : null}
          />
          {failed ? <p role="alert" className="pt-journey-alert">{strings.saveError}</p> : null}
        </div>
      ) : null}

      {view ? (
        <>
          <ol className="pt-journey-steps" aria-label={strings.stepsLabel} data-timed={timed ? "true" : "false"}>
            {view.steps.map((step) => {
              const expanded = open.has(step.id);
              const panelId = `${baseId}-${step.id}`;
              const periodId = `${panelId}-period`;
              return (
                <li key={step.id} className="pt-step" data-open={expanded ? "true" : "false"}>
                  <div className="pt-step-head">
                    <span className="pt-step-node" aria-hidden="true">{step.order}</span>
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
                      </h3>
                      <p className="pt-step-goal">{step.summary}</p>
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
        </>
      ) : null}
    </section>
  );
}
