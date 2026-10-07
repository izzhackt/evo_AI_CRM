"use client";

import { startTransition, useActionState, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import type { AiAutosendSaveState } from "@/lib/platform-ai-agent-autosend-actions";
import {
  AI_AUTOSEND_COPY,
  AI_AUTOSEND_DAY_LABEL,
  AI_AUTOSEND_DAY_NAME,
  AI_AUTOSEND_DAY_TOKEN,
  AI_AUTOSEND_DAYS,
  AI_AUTOSEND_DELAY_RANGE,
  AI_AUTOSEND_DISCLOSURE_LIMIT,
  AI_AUTOSEND_LANGUAGE_LABEL,
  AI_AUTOSEND_LANGUAGES,
  AI_AUTOSEND_LIMIT_CEILING,
  AI_AUTOSEND_MAX_LIVE_TEST,
  AI_AUTOSEND_MAX_OVERRIDES,
  AI_AUTOSEND_MAX_SPANS,
  AI_AUTOSEND_PHRASE_LIMIT,
  aiAutosendConversationFromLink,
  aiAutosendOvernight,
  aiAutosendSettingsIssues,
  aiAutosendTrimmed,
  type AiAutosendDay,
  type AiAutosendIssue,
  type AiAutosendLanguage,
  type AiAutosendOverride,
  type AiAutosendPhrase,
  type AiAutosendSettings,
  type AiAutosendSpan,
} from "@/lib/v3/ai-agent-autosend";

type Status = AiAutosendSaveState["status"];

const MESSAGES: Readonly<Record<Exclude<Status, "idle">, string>> = {
  saved: "Настройки сохранены.",
  conflict: `${AI_AUTOSEND_COPY.conflict}.`,
  forbidden: "Нет права менять настройки автоответчика.",
  invalid: "Проверьте отмеченные поля.",
  consent_required: "База не приняла настройки — обновите страницу.",
  unavailable: "Результат пока неизвестен — безопасно сохраните ещё раз.",
  sender_required: "Чаты живого теста меняет только тот, кто сам отвечает клиентам в WhatsApp. Верните список как был — остальное сохранится.",
  chat_unavailable: "Один из чатов живого теста вам недоступен — уберите его из списка.",
  shadow_nights_required: "Чаты живого теста можно добавить только после трёх ночей проверки без отправки. Уберите их из списка — остальное сохранится.",
};

/** Номера дней недели ISO (1 — понедельник): так их хранит база (`working_days`). */
const ISO_DAY: Readonly<Record<AiAutosendDay, number>> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/**
 * Поле настройки — та же рамка, что `QUEUE_FIELD` (16 px, 44 px), но без
 * `block w-full`: время, даты и числа стоят в строке своей ширины.
 */
const fieldCls = "h-11 min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3";
/** «Сохранить настройки» без правок — токены поверхности, как у недоступных кнопок очереди (без opacity). */
const SAVE_IDLE = "aria-disabled:cursor-not-allowed aria-disabled:border-border aria-disabled:bg-surface-2 aria-disabled:text-fg-3 aria-disabled:shadow-none aria-disabled:hover:border-border aria-disabled:hover:bg-surface-2 aria-disabled:active:scale-100";
/** Ширина под «20:00» и под «08:00 PM» (браузер с английской локалью пишет время в 12 часов). */
const timeCls = `${fieldCls} w-[8.75rem] tabular-nums`;
const textLinkCls =
  "inline-flex min-h-11 items-center gap-1 rounded-nav px-1.5 -mx-1.5 t-label text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg disabled:cursor-not-allowed disabled:text-fg-3 disabled:no-underline";
const iconButtonCls =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:text-fg-3";

function todayInBishkek(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Ошибки по полю: точное совпадение или вложенные (`schedule.mon.0` у `schedule.mon`). */
function issuesFor(issues: readonly AiAutosendIssue[], field: string): readonly string[] {
  return [...new Set(issues.filter((issue) => issue.field === field || issue.field.startsWith(`${field}.`)).map((issue) => issue.message))];
}

function FieldIssues({ messages, id }: Readonly<{ messages: readonly string[]; id?: string }>) {
  if (messages.length === 0) return null;
  return (
    <p id={id} className="mt-1 flex items-start gap-1.5 t-body-compact text-danger">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <span>{messages.join(" ")}</span>
    </p>
  );
}

/** Строка настройки: подпись слева (с 64 rem), управление справа; на телефоне — одна колонка. */
function Row({ title, hint, children, testId }: Readonly<{ title: string; hint?: ReactNode; children: ReactNode; testId?: string }>) {
  const id = useId();
  return (
    <fieldset
      className="grid gap-x-8 gap-y-3 border-t border-border py-5 first:border-t-0 first:pt-0 @4xl:grid-cols-[13rem_minmax(0,1fr)]"
      aria-describedby={hint ? `${id}-hint` : undefined}
      data-testid={testId}
    >
      <legend className="contents">
        <span className="block">
          <span className="block t-item text-fg">{title}</span>
          {hint ? <span id={`${id}-hint`} className="mt-1 block t-meta text-fg-3">{hint}</span> : null}
        </span>
      </legend>
      <div className="min-w-0">{children}</div>
    </fieldset>
  );
}

function PhraseField({
  label,
  phrase,
  limit,
  issues,
  onChange,
  testId,
}: Readonly<{
  label: string;
  phrase: AiAutosendPhrase;
  limit: number;
  issues: readonly string[];
  onChange: (next: AiAutosendPhrase) => void;
  testId: string;
}>) {
  const id = useId();
  return (
    <div className="space-y-1.5" data-testid={testId} data-confirmed={phrase.confirmed}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className="t-label text-fg-2">{label}</label>
        {phrase.confirmed ? null : <StatusChip label={AI_AUTOSEND_COPY.unchecked} tone="warn" />}
      </div>
      <textarea
        id={id}
        rows={3}
        maxLength={limit}
        value={phrase.text}
        aria-invalid={issues.length > 0 || undefined}
        aria-describedby={issues.length > 0 ? `${id}-issues` : undefined}
        // Изменённый текст владелец ещё не подтверждал — отметка снимается.
        onChange={(event) => onChange({ text: event.target.value.replace(/[\r\n]+/gu, " "), confirmed: false })}
        className={`${fieldCls} block h-auto min-h-[5.5rem] w-full resize-y py-2.5 leading-6`}
      />
      <FieldIssues id={`${id}-issues`} messages={issues} />
      <label className="inline-flex min-h-11 items-center gap-2 t-body-compact text-fg">
        <input
          type="checkbox"
          checked={phrase.confirmed}
          onChange={(event) => onChange({ text: phrase.text, confirmed: event.target.checked })}
          className="size-4 shrink-0 accent-[var(--text)]"
        />
        {AI_AUTOSEND_COPY.checked}
      </label>
    </div>
  );
}

/**
 * Настройки автоответчика (план §11, «Настройки»): расписание по дням с
 * переходом через полночь, особые даты, рабочие дни, задержка и лимиты,
 * финальные фразы и строка о помощнике на трёх языках, чаты живого теста.
 * Всё — одной записью «Сохранить настройки» с ожидаемой версией: чужое
 * изменение — «Настройки изменились — обновите страницу». Проверки до записи
 * — те же, что CHECK базы (275); база решает окончательно.
 */
export function AiAutosendSettingsForm({
  initial,
  version,
  liveTestTitles,
  liveTestLock,
  readOnly,
  requestId: initialRequestId,
  action,
}: Readonly<{
  initial: AiAutosendSettings;
  version: number;
  /** Названия чатов живого теста из чтения; новый чат — «чат по ссылке» до сохранения. */
  liveTestTitles: Readonly<Record<string, string>>;
  /** Почему чаты живого теста пока не добавить (`aiAutosendLiveTestLock`): поле ссылки не показывается. */
  liveTestLock: string | null;
  /** Просмотр роли или чтение без записи: поля видны, но не меняются. */
  readOnly: boolean;
  requestId: string;
  action: (previous: AiAutosendSaveState, form: FormData) => Promise<AiAutosendSaveState>;
}>) {
  const formId = useId();
  const [draft, setDraft] = useState<AiAutosendSettings>(initial);
  const [tried, setTried] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkIssue, setLinkIssue] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(initialRequestId);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const issues = useMemo(() => aiAutosendSettingsIssues(draft), [draft]);
  const shown = tried ? issues : [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const [state, run, pending] = useActionState(async (previous: AiAutosendSaveState, form: FormData): Promise<AiAutosendSaveState> => {
    try {
      const result = await action(previous, form);
      if (result.status === "saved" || result.status === "conflict" || result.status === "invalid") setRequestId(crypto.randomUUID());
      if (result.status === "saved") setTried(false);
      return result;
    } catch {
      return { status: "unavailable", requestId: previous.requestId };
    }
  }, { status: "idle", requestId: null });

  const update = (patch: Partial<AiAutosendSettings>) => setDraft((current) => ({ ...current, ...patch }));
  const setSpans = (day: AiAutosendDay, spans: readonly AiAutosendSpan[]) =>
    setDraft((current) => ({ ...current, schedule: { ...current.schedule, [day]: spans } }));
  const setOverride = (index: number, patch: Partial<AiAutosendOverride>) =>
    setDraft((current) => ({ ...current, dateOverrides: current.dateOverrides.map((item, at) => (at === index ? { ...item, ...patch } : item)) }));
  const setPhrase = (language: AiAutosendLanguage, kind: "tomorrow" | "day", phrase: AiAutosendPhrase) =>
    setDraft((current) => ({ ...current, phrases: { ...current.phrases, [language]: { ...current.phrases[language], [kind]: phrase } } }));
  const setDisclosure = (language: AiAutosendLanguage, phrase: AiAutosendPhrase) =>
    setDraft((current) => ({ ...current, disclosure: { ...current.disclosure, [language]: phrase } }));
  const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

  function addLiveTest() {
    const id = aiAutosendConversationFromLink(linkInput);
    if (!id) { setLinkIssue("Вставьте ссылку на чат из «Продажи → WhatsApp»."); return; }
    if (draft.liveTestConversationIds.includes(id)) { setLinkIssue("Этот чат уже в списке."); return; }
    setLinkIssue(null);
    setLinkInput("");
    update({ liveTestConversationIds: [...draft.liveTestConversationIds, id] });
  }

  return (
    <form
      id={formId}
      aria-busy={pending}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (readOnly || !dirty) return;
        setTried(true);
        if (issues.length > 0) {
          requestAnimationFrame(() => statusRef.current?.focus());
          return;
        }
        const form = new FormData(event.currentTarget);
        startTransition(() => run(form));
      }}
      className="rounded-card border border-border bg-surface px-4 py-5 sm:px-6"
      data-testid="v3-ai-autosend-settings"
      data-dirty={dirty || undefined}
    >
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="expected_version" value={String(version)} />
      {/* Пробелы по краям фраз не уходят в базу (275: text = btrim(text)); baseline — для записи только изменённого. */}
      <input type="hidden" name="settings" value={JSON.stringify(aiAutosendTrimmed(draft))} />
      <input type="hidden" name="baseline" value={JSON.stringify(initial)} />

      <fieldset disabled={readOnly} className="@container min-w-0">
        <Row title="Расписание" hint="По Бишкеку (Asia/Bishkek), не меняется" testId="v3-ai-autosend-schedule">
          <ul className="divide-y divide-border rounded-ctl border border-border">
            {AI_AUTOSEND_DAYS.map((day) => {
              const spans = draft.schedule[day];
              return (
                <li key={day} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-2 px-3 py-1.5" data-day={day}>
                  <span className="pt-3 t-label text-fg" aria-hidden="true">{AI_AUTOSEND_DAY_LABEL[day]}</span>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                    {spans.length === 0 ? <span className="py-3 t-body-compact text-fg-3">Не отвечает</span> : null}
                    {spans.map((span, index) => {
                      const overnight = aiAutosendOvernight(span);
                      const name = `${AI_AUTOSEND_DAY_NAME[day]}, интервал ${index + 1}`;
                      return (
                        <span key={index} className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="v3-ai-autosend-span">
                          <input type="time" required value={span.from} aria-label={`${name}: с`} className={timeCls}
                            onChange={(event) => setSpans(day, spans.map((item, at) => (at === index ? { ...item, from: event.target.value } : item)))} />
                          <span aria-hidden="true" className="text-fg-3">–</span>
                          <input type="time" required value={span.to} aria-label={`${name}: до`} className={timeCls}
                            onChange={(event) => setSpans(day, spans.map((item, at) => (at === index ? { ...item, to: event.target.value } : item)))} />
                          {overnight ? <span className="t-meta text-fg-2" data-testid="v3-ai-autosend-overnight">{overnight}</span> : null}
                          <button type="button" className={iconButtonCls} aria-label={`Убрать: ${name}`}
                            onClick={() => setSpans(day, spans.filter((_, at) => at !== index))}>
                            <Icon name="x" size={16} />
                          </button>
                        </span>
                      );
                    })}
                    {spans.length < AI_AUTOSEND_MAX_SPANS ? (
                      <button type="button" className={textLinkCls} aria-label={`Добавить интервал: ${AI_AUTOSEND_DAY_NAME[day]}`}
                        onClick={() => setSpans(day, [...spans, spans.length === 0 ? { from: "20:00", to: "09:00" } : { from: "13:00", to: "14:00" }])}>
                        <Icon name="plus" size={16} />
                        Интервал
                      </button>
                    ) : null}
                  </div>
                  <span className="sr-only">{AI_AUTOSEND_DAY_NAME[day]}</span>
                </li>
              );
            })}
          </ul>
          <FieldIssues messages={issuesFor(shown, "schedule")} />
        </Row>

        <Row title="Особые даты" hint="Праздники и выходные; «включён весь день» — тоже нерабочий день для звонка" testId="v3-ai-autosend-overrides">
          {draft.dateOverrides.length === 0 ? <p className="t-body-compact text-fg-3">Особых дат нет.</p> : (
            <ul className="space-y-2">
              {draft.dateOverrides.map((item, index) => {
                const name = `Особые даты ${index + 1}`;
                return (
                  <li key={index} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="v3-ai-autosend-override">
                    <input type="date" value={item.from} aria-label={`${name}: с`} className={`${fieldCls} w-[10.25rem] tabular-nums`}
                      onChange={(event) => setOverride(index, { from: event.target.value })} />
                    <span aria-hidden="true" className="text-fg-3">–</span>
                    <input type="date" value={item.to} aria-label={`${name}: по`} className={`${fieldCls} w-[10.25rem] tabular-nums`}
                      onChange={(event) => setOverride(index, { to: event.target.value })} />
                    <select value={item.mode} aria-label={`${name}: автоответчик`} className={`${fieldCls} w-auto pe-8`}
                      onChange={(event) => setOverride(index, { mode: event.target.value === "on" ? "on" : "off" })}>
                      <option value="on">{AI_AUTOSEND_COPY.dayOn}</option>
                      <option value="off">{AI_AUTOSEND_COPY.dayOff}</option>
                    </select>
                    <button type="button" className={iconButtonCls} aria-label={`Убрать: ${name}`}
                      onClick={() => update({ dateOverrides: draft.dateOverrides.filter((_, at) => at !== index) })}>
                      <Icon name="x" size={16} />
                    </button>
                    <FieldIssues messages={issuesFor(shown, `dateOverrides.${index}`)} />
                  </li>
                );
              })}
            </ul>
          )}
          {draft.dateOverrides.length < AI_AUTOSEND_MAX_OVERRIDES ? (
            <button type="button" className={`${textLinkCls} mt-1`}
              onClick={() => { const today = todayInBishkek(); update({ dateOverrides: [...draft.dateOverrides, { from: today, to: today, mode: "off" }] }); }}>
              <Icon name="plus" size={16} />
              Добавить даты
            </button>
          ) : null}
        </Row>

        <Row title="Рабочие дни" hint="Для дня звонка в финальной фразе и задачи «Позвонить клиенту»" testId="v3-ai-autosend-working-days">
          <div className="flex flex-wrap gap-2">
            {AI_AUTOSEND_DAYS.map((day) => {
              const iso = ISO_DAY[day];
              const checked = draft.workingDays.includes(iso);
              return (
                <label key={day} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-nav border border-border bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 has-[:checked]:border-fg-3 has-[:checked]:bg-surface-2 has-[:checked]:text-fg">
                  <input type="checkbox" checked={checked} className="size-4 shrink-0 accent-[var(--text)]"
                    aria-label={AI_AUTOSEND_DAY_NAME[day]}
                    onChange={(event) => update({ workingDays: event.target.checked
                      ? [...draft.workingDays, iso].sort((left, right) => left - right)
                      : draft.workingDays.filter((value) => value !== iso) })} />
                  <span aria-hidden="true">{AI_AUTOSEND_DAY_LABEL[day]}</span>
                </label>
              );
            })}
          </div>
          <FieldIssues messages={issuesFor(shown, "workingDays")} />
        </Row>

        <Row title="Задержка и лимиты" hint="Лимиты можно только снизить" testId="v3-ai-autosend-limits">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <span className="block t-label text-fg-2" id={`${formId}-delay`}>Пауза перед ответом, с</span>
              <div className="mt-1 flex items-center gap-2" role="group" aria-labelledby={`${formId}-delay`}>
                <input type="number" inputMode="numeric" min={AI_AUTOSEND_DELAY_RANGE.min} max={AI_AUTOSEND_DELAY_RANGE.max} aria-label="Пауза от, секунд"
                  value={Number.isFinite(draft.delayMinSeconds) ? draft.delayMinSeconds : ""} className={`${fieldCls} w-20 tabular-nums`}
                  onChange={(event) => update({ delayMinSeconds: number(event.target.value) })} />
                <span aria-hidden="true" className="text-fg-3">–</span>
                <input type="number" inputMode="numeric" min={AI_AUTOSEND_DELAY_RANGE.min} max={AI_AUTOSEND_DELAY_RANGE.max} aria-label="Пауза до, секунд"
                  value={Number.isFinite(draft.delayMaxSeconds) ? draft.delayMaxSeconds : ""} className={`${fieldCls} w-20 tabular-nums`}
                  onChange={(event) => update({ delayMaxSeconds: number(event.target.value) })} />
              </div>
              <FieldIssues messages={issuesFor(shown, "delay")} />
            </div>
            {([
              ["limitChatHour", "Ответов в чате за час"],
              ["limitChatNight", "Ответов в чате за ночь"],
              ["limitNumberHour", "Ответов с номера за час"],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className="block t-label text-fg-2" htmlFor={`${formId}-${key}`}>{label}</label>
                <div className="mt-1 flex items-center gap-2">
                  <input id={`${formId}-${key}`} type="number" inputMode="numeric" min={1} max={AI_AUTOSEND_LIMIT_CEILING[key]}
                    value={Number.isFinite(draft[key]) ? draft[key] : ""} className={`${fieldCls} w-20 tabular-nums`}
                    onChange={(event) => update({ [key]: number(event.target.value) })} />
                  <span className="t-meta text-fg-3">не больше {AI_AUTOSEND_LIMIT_CEILING[key]}</span>
                </div>
                <FieldIssues messages={issuesFor(shown, key)} />
              </div>
            ))}
          </div>
        </Row>

        <Row title="Финальная фраза" hint={<>После неё автоответчик в этом чате молчит до утра. {AI_AUTOSEND_DAY_TOKEN} — «В понедельник», «Сегодня» или дата</>} testId="v3-ai-autosend-phrases">
          <div className="grid gap-x-6 gap-y-6 @5xl:grid-cols-3">
            {AI_AUTOSEND_LANGUAGES.map((language) => (
              <div key={language} className="space-y-3" lang={language} data-language={language}>
                <h4 className="t-label text-fg">{AI_AUTOSEND_LANGUAGE_LABEL[language]}</h4>
                <PhraseField label="Звонок завтра" phrase={draft.phrases[language].tomorrow} limit={AI_AUTOSEND_PHRASE_LIMIT}
                  issues={issuesFor(shown, `phrases.${language}.tomorrow`)} testId={`v3-ai-autosend-phrase-${language}-tomorrow`}
                  onChange={(phrase) => setPhrase(language, "tomorrow", phrase)} />
                <PhraseField label="Звонок в другой день" phrase={draft.phrases[language].day} limit={AI_AUTOSEND_PHRASE_LIMIT}
                  issues={issuesFor(shown, `phrases.${language}.day`)} testId={`v3-ai-autosend-phrase-${language}-day`}
                  onChange={(phrase) => setPhrase(language, "day", phrase)} />
              </div>
            ))}
          </div>
        </Row>

        <Row title="Строка о помощнике" hint="Первая строка первого ночного ответа в чате" testId="v3-ai-autosend-disclosure">
          <label className="inline-flex min-h-11 items-center gap-2 t-body-compact text-fg">
            <input type="checkbox" checked={draft.disclosureEnabled} className="size-4 shrink-0 accent-[var(--text)]"
              onChange={(event) => update({ disclosureEnabled: event.target.checked })} />
            Писать строку о помощнике
          </label>
          {draft.disclosureEnabled ? (
            <div className="mt-3 grid gap-x-6 gap-y-6 @5xl:grid-cols-3">
              {AI_AUTOSEND_LANGUAGES.map((language) => (
                <div key={language} lang={language}>
                  <PhraseField label={AI_AUTOSEND_LANGUAGE_LABEL[language]} phrase={draft.disclosure[language]} limit={AI_AUTOSEND_DISCLOSURE_LIMIT}
                    issues={issuesFor(shown, `disclosure.${language}`)} testId={`v3-ai-autosend-disclosure-${language}`}
                    onChange={(phrase) => setDisclosure(language, phrase)} />
                </div>
              ))}
            </div>
          ) : null}
        </Row>

        <Row title="Живой тест" hint="В «Проверке без отправки» эти чаты получают ответы по-настоящему. До трёх" testId="v3-ai-autosend-live-test">
          {draft.liveTestConversationIds.length === 0 ? <p className="t-body-compact text-fg-3">Чатов нет.</p> : (
            <ul className="space-y-1">
              {draft.liveTestConversationIds.map((id) => {
                const title = liveTestTitles[id] ?? "Чат по ссылке — название после сохранения";
                return (
                  <li key={id} className="flex items-center justify-between gap-3 rounded-ctl border border-border px-3" data-testid="v3-ai-autosend-live-test-chat">
                    <a href={`/v3/inbox?conversation=${id}`} className="min-w-0 truncate py-3 t-body-compact text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg">{title}</a>
                    <button type="button" className={iconButtonCls} aria-label={`Убрать из живого теста: ${title}`}
                      onClick={() => update({ liveTestConversationIds: draft.liveTestConversationIds.filter((value) => value !== id) })}>
                      <Icon name="x" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {draft.liveTestConversationIds.length >= AI_AUTOSEND_MAX_LIVE_TEST ? null : liveTestLock ? (
            // 277 не примет непустой список до трёх ночей проверки: добавлять нечем, убрать — можно.
            <p className="mt-2 flex items-start gap-1.5 t-body-compact text-fg-2" data-testid="v3-ai-autosend-live-test-lock">
              <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
              <span>{liveTestLock}</span>
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <input type="url" inputMode="url" value={linkInput} placeholder="Ссылка на чат" aria-label="Ссылка на чат для живого теста"
                aria-invalid={linkIssue ? true : undefined} className={`${fieldCls} min-w-0 flex-1 basis-64`}
                onChange={(event) => { setLinkInput(event.target.value); setLinkIssue(null); }}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLiveTest(); } }} />
              <button type="button" className={QUEUE_SECONDARY} onClick={addLiveTest}>Добавить</button>
            </div>
          )}
          <FieldIssues messages={linkIssue ? [linkIssue] : issuesFor(shown, "liveTest")} />
        </Row>
      </fieldset>

      {readOnly ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-5">
          {/* Без изменений сохранять нечего: кнопка ждёт правки (aria-disabled — фокус не теряется). */}
          <button type="submit" className={`${btnCls} ${SAVE_IDLE}`} disabled={pending} aria-disabled={!dirty || undefined}>
            {pending ? "Сохраняю…" : "Сохранить настройки"}
          </button>
          <p
            ref={statusRef}
            tabIndex={-1}
            role={state.status === "saved" || (!tried && state.status === "idle") ? "status" : "alert"}
            className={`t-body-compact outline-none ${tried && issues.length > 0 ? "text-danger" : state.status === "idle" || state.status === "saved" ? "text-fg-2" : "text-danger"}`}
            data-testid="v3-ai-autosend-settings-status"
          >
            {tried && issues.length > 0 ? MESSAGES.invalid
              : state.status === "shadow_nights_required" && liveTestLock ? `${liveTestLock} Уберите чаты из списка — остальное сохранится.`
                : state.status !== "idle" ? MESSAGES[state.status]
                : dirty ? "Есть несохранённые изменения." : null}
          </p>
        </div>
      )}
    </form>
  );
}
