"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls } from "@/components/ui";
import type { TelephonyServerFacts } from "@/lib/v3/telephony-health";
import {
  TELEPHONY_BOUNDS,
  TELEPHONY_DAY_LABEL,
  TELEPHONY_DAY_NAME,
  TELEPHONY_FLAG_COPY,
  TELEPHONY_FLAG_KEYS,
  TELEPHONY_NUMBER_LABEL,
  normalizeTelephonySaveReceipt,
  parseTelephonyPrefixes,
  telephonyDraftFrom,
  telephonyDraftIssues,
  telephonyErrorMessage,
  telephonyOpeningFlags,
  telephonyPatchFrom,
  type TelephonyDraft,
  type TelephonyFlagKey,
  type TelephonyIssue,
  type TelephonyNumberKey,
  type TelephonyOverview,
} from "@/lib/v3/telephony-settings";

/**
 * Правка настроек телефонии (план §5.5, §6.4, §9.1): включатели, рабочее время,
 * набор, потолки автоматики, получатель эскалаций. Одна запись «Сохранить» с
 * версией, которую человек видел: чужое изменение — «Настройки уже изменили».
 * Проверки до записи те же, что у CHECK таблицы (288); база решает окончательно.
 * Включатели, которые что-то «открывают» (интерфейс, набор, задачи, лиды, разбор,
 * импорт, снятие паузы), просят отметить, что человек понимает последствия.
 */

const fieldCls = "h-11 min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3";
/** Числа в строках одной ширины: подписи разной длины не сбивают сетку. */
const NUMBER_GRID = "mt-3 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-x-4 gap-y-3";
const SAVE_IDLE = "aria-disabled:cursor-not-allowed aria-disabled:border-border aria-disabled:bg-surface-2 aria-disabled:text-fg-3 aria-disabled:shadow-none aria-disabled:hover:border-border aria-disabled:hover:bg-surface-2 aria-disabled:active:scale-100";

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

function FieldIssues({ messages }: Readonly<{ messages: readonly string[] }>) {
  if (messages.length === 0) return null;
  return (
    <p className="mt-1 flex items-start gap-1.5 t-body-compact text-danger">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <span>{messages.join(" ")}</span>
    </p>
  );
}

const issuesFor = (issues: readonly TelephonyIssue[], ...fields: string[]) =>
  [...new Set(issues.filter((issue) => fields.includes(issue.field)).map((issue) => issue.message))];

/** Что стоит рядом с включателем кроме подсказки: факт сервера, который не даёт ему сработать. */
function flagServerNote(key: TelephonyFlagKey, server: TelephonyServerFacts): string | null {
  if ((key === "projectionEnabled" || key === "uiEnabled") && !server.ingestEnabled) {
    return "Приём событий выключен на сервере: звонков для разбора нет, пока технический специалист его не включит.";
  }
  if ((key === "dialEnabled" || key === "backfillEnabled" || key === "outboundPaused") && server.pbx !== "ready") {
    return server.pbx === "invalid"
      ? "Параметры ВАТС на сервере заданы неверно: запросы к ВАТС не идут."
      : "Ключ ВАТС на сервере не задан: запросы к ВАТС не идут, пока его не внесут.";
  }
  return null;
}

export function TelephonySettingsForm({
  overview,
  server,
  readOnly,
}: Readonly<{ overview: TelephonyOverview; server: TelephonyServerFacts; readOnly: boolean }>) {
  const router = useRouter();
  const { settings, staff } = overview;
  const initial = useMemo(() => telephonyDraftFrom(settings), [settings]);
  const [draft, setDraft] = useState<TelephonyDraft>(initial);
  const [tried, setTried] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState("");
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [result, setResult] = useState<Readonly<{ tone: "ok" | "error"; text: string }> | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const issues = useMemo(() => telephonyDraftIssues(draft), [draft]);
  const shown = tried ? issues : [];
  const patch = useMemo(() => (issues.length === 0 ? telephonyPatchFrom(settings, draft) : null), [issues, settings, draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const opening = useMemo(() => telephonyOpeningFlags(settings, draft), [settings, draft]);
  // Отметка «понимаю» относится к тому набору, что открывается сейчас: изменился набор — отметка снимается.
  const openingKey = opening.join(",");
  const understood = opening.length > 0 && confirmedKey === openingKey;
  const prefixes = parseTelephonyPrefixes(draft.prefixes);
  const managers = staff.filter((option) => option.canManage || option.membershipId === settings.escalationMembershipId);

  const update = (next: Partial<TelephonyDraft>) => { setDraft((current) => ({ ...current, ...next })); setResult(null); };
  const setFlag = (key: TelephonyFlagKey, value: boolean) => update({ flags: { ...draft.flags, [key]: value } });
  const setNumber = (key: TelephonyNumberKey, value: string) => update({ numbers: { ...draft.numbers, [key]: value } });
  const toggleDay = (day: number) => update({
    workingDays: draft.workingDays.includes(day) ? draft.workingDays.filter((item) => item !== day) : [...draft.workingDays, day].sort((a, b) => a - b),
  });

  async function save() {
    if (readOnly || pending || !dirty) return;
    setTried(true);
    if (issues.length > 0) {
      requestAnimationFrame(() => statusRef.current?.focus());
      return;
    }
    if (patch === null) {
      setResult({ tone: "ok", text: "Менять нечего." });
      return;
    }
    if (opening.length > 0 && !understood) {
      setResult({ tone: "error", text: "Отметьте, что понимаете, что откроют включённые пункты." });
      requestAnimationFrame(() => statusRef.current?.focus());
      return;
    }
    setPending(true);
    setResult(null);
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    try {
      const response = await fetch("/api/v3/telephony/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: id, expectedVersion: settings.version, patch }),
      });
      const body = (await response.json().catch(() => null)) as { receipt?: unknown; error?: { code?: string; constraint?: string } } | null;
      const receipt = response.ok ? normalizeTelephonySaveReceipt(body?.receipt) : null;
      if (receipt) {
        setRequestId(null);
        setTried(false);
        setConfirmedKey("");
        setResult({
          tone: "ok",
          text: receipt.status === "unchanged" ? "Менять нечего." : receipt.automationStopCleared ? "Сохранено. Отметка «остановлено по потолку» снята." : "Сохранено.",
        });
        router.refresh();
      } else if (response.status >= 400 && response.status < 500) {
        // Определённый отказ: тот же запрос ничего не изменит — новый id.
        setRequestId(null);
        setResult({ tone: "error", text: telephonyErrorMessage(body?.error?.code, body?.error?.constraint) });
      } else {
        // Результат неизвестен: повтор уйдёт с тем же id, и база вернёт прежнюю квитанцию.
        setResult({ tone: "error", text: telephonyErrorMessage(null) });
      }
    } catch {
      setResult({ tone: "error", text: telephonyErrorMessage(null) });
    } finally {
      setPending(false);
    }
  }

  const numberField = (key: TelephonyNumberKey, extra?: string, tall = false) => {
    const bounds = TELEPHONY_BOUNDS[key];
    const id = `tel-${key}`;
    return (
      <div key={key}>
        {/* Подпись держит высоту двух строк и стоит у нижнего края: поля соседних ячеек начинаются на одной линии,
            а единица («секунд», «рабочих минут») — справа от поля, а не под ним. */}
        <label htmlFor={id} className={`flex ${tall ? "min-h-10" : "min-h-6"} items-end t-label text-fg-2`}>{TELEPHONY_NUMBER_LABEL[key]}</label>
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          <input id={id} type="number" inputMode="numeric" min={bounds.min} max={bounds.max} step={1} value={draft.numbers[key]}
            aria-invalid={issuesFor(shown, key).length > 0 || undefined}
            className={`${fieldCls} block w-28 tabular-nums`} onChange={(event) => setNumber(key, event.target.value)} />
          {extra ? <span className="t-meta text-fg-3">{extra}</span> : null}
        </div>
        <FieldIssues messages={issuesFor(shown, key)} />
      </div>
    );
  };

  return (
    <form
      noValidate
      aria-busy={pending}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      className="rounded-card border border-border bg-surface px-4 py-5 sm:px-6"
      data-testid="v3-telephony-settings"
      data-dirty={dirty || undefined}
    >
      <fieldset disabled={readOnly || pending} className="@container min-w-0">
        <Row title="Включатели" hint="Пока включатель не включён здесь, сотрудникам ничего не показывается" testId="v3-telephony-flags">
          {/* Светлая подложка формы: ручка включённого переключателя — цвета листа, иначе она сливается с тёмной дорожкой. */}
          <ul className="space-y-3" style={{ "--switch-thumb-on": "var(--surface)" } as CSSProperties}>
            {TELEPHONY_FLAG_KEYS.map((key) => {
              const copy = TELEPHONY_FLAG_COPY[key];
              const note = flagServerNote(key, server);
              const id = `tel-flag-${key}`;
              const on = draft.flags[key];
              return (
                <li key={key} data-flag={key} data-on={on || undefined}>
                  {/* Настоящий переключатель (тот же `v3-switch`, что у автоответчика): дорожка и слово «Включено»/«Выключено»,
                      а не квадратик флажка. Нажатие на слова тоже переключает. */}
                  <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3">
                    <button id={id} type="button" role="switch" aria-checked={on} onClick={() => setFlag(key, !on)}
                      aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`} className="v3-switch -mt-1.5">
                      <span className="v3-switch-track" aria-hidden="true" />
                    </button>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span id={`${id}-title`} className="t-body text-fg">{copy.title}</span>
                        <span className={`t-meta font-medium ${on ? "text-fg" : "text-fg-3"}`} data-testid="v3-telephony-flag-state">{on ? "Включено" : "Выключено"}</span>
                      </span>
                      <span id={`${id}-hint`} className="block t-meta text-fg-3">{copy.hint}</span>
                      {note ? <span className="mt-0.5 block t-meta text-fg-2">{note}</span> : null}
                    </span>
                  </label>
                  <FieldIssues messages={issuesFor(shown, key)} />
                </li>
              );
            })}
          </ul>
        </Row>

        <Row title="Рабочее время и перезвон" hint="По Бишкеку; от этого считается срок задачи «Перезвонить»" testId="v3-telephony-hours">
          <div role="group" aria-label="Рабочие дни" className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <label key={day} className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 has-[:checked]:border-fg has-[:checked]:bg-surface-2 has-[:checked]:text-fg">
                <input type="checkbox" className="sr-only" checked={draft.workingDays.includes(day)} onChange={() => toggleDay(day)} aria-label={TELEPHONY_DAY_NAME[day]} />
                <span aria-hidden="true">{TELEPHONY_DAY_LABEL[day]}</span>
              </label>
            ))}
          </div>
          <FieldIssues messages={issuesFor(shown, "workingDays")} />
          <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
            <div>
              <label htmlFor="tel-work-from" className="flex min-h-6 items-end t-label text-fg-2">С</label>
              {/* Системное поле времени: на телефоне — колесо выбора, на компьютере — по сегментам. Вид («18:00» или «06:00 PM»)
                  задаёт язык устройства, а значение всегда «ЧЧ:ММ», как ждёт база; поле с цифровой клавиатурой без «:» на телефоне не годится. */}
              <input id="tel-work-from" type="time" required value={draft.workFrom} className={`${fieldCls} mt-1 block w-[8.75rem] tabular-nums`}
                aria-invalid={issuesFor(shown, "workFrom").length > 0 || undefined} onChange={(event) => update({ workFrom: event.target.value })} />
            </div>
            <div>
              <label htmlFor="tel-work-to" className="flex min-h-6 items-end t-label text-fg-2">До</label>
              <input id="tel-work-to" type="time" required value={draft.workTo} className={`${fieldCls} mt-1 block w-[8.75rem] tabular-nums`}
                aria-invalid={issuesFor(shown, "workTo").length > 0 || undefined} onChange={(event) => update({ workTo: event.target.value })} />
            </div>
            {numberField("callbackWorkMinutes", "рабочих минут")}
          </div>
          <FieldIssues messages={issuesFor(shown, "workFrom", "workTo")} />
        </Row>

        <Row title="Набор из CRM" hint="Страны, куда можно звонить, и лимиты. ВАТС ограничивает направления и сама" testId="v3-telephony-dial">
          <label htmlFor="tel-prefixes" className="t-label text-fg-2">Разрешённые коды стран</label>
          <input id="tel-prefixes" type="text" value={draft.prefixes} autoComplete="off" spellCheck={false} placeholder="+996, +7"
            aria-invalid={issuesFor(shown, "dialPrefixes").length > 0 || undefined}
            className={`${fieldCls} mt-1 block w-full max-w-md`} onChange={(event) => update({ prefixes: event.target.value })} />
          <span className="mt-0.5 block t-meta text-fg-3">
            Через запятую или пробел. Сейчас: {prefixes.invalid.length === 0 && prefixes.list.length > 0 ? prefixes.list.join(" ") : "—"}.
          </span>
          <FieldIssues messages={issuesFor(shown, "dialPrefixes")} />
          <div className={NUMBER_GRID}>
            {numberField("limitUserDay", undefined, true)}
            {numberField("limitUserGapSeconds", "секунд", true)}
            {numberField("limitOrgHour", undefined, true)}
            {numberField("limitOrgDay", undefined, true)}
          </div>
        </Row>

        <Row title="Потолки автоматики" hint="Защита от лишних лидов и задач при утёкшем ключе: при превышении автоматика выключается сама" testId="v3-telephony-ceilings">
          <div className={NUMBER_GRID}>
            {numberField("ceilingLeadsHour")}
            {numberField("ceilingLeadsDay")}
            {numberField("ceilingTasksHour")}
            {numberField("ceilingTasksDay")}
          </div>
        </Row>

        <Row title="Эскалации" hint="Кому уходит то, у чего нет владельца. Только администратор или руководитель телефонии" testId="v3-telephony-escalation">
          <label htmlFor="tel-escalation" className="sr-only">Получатель эскалаций</label>
          <select id="tel-escalation" value={draft.escalationMembershipId} className={`${fieldCls} w-72 max-w-full`}
            onChange={(event) => update({ escalationMembershipId: event.target.value })}>
            <option value="">Не назначен: решает директор</option>
            {managers.map((option) => (
              <option key={option.membershipId} value={option.membershipId}>
                {option.name}{option.canManage ? "" : " · права больше нет"}
              </option>
            ))}
          </select>
          {overview.escalation && !overview.escalation.allowed ? (
            <p className="mt-1 flex items-start gap-1.5 t-body-compact text-danger" data-testid="v3-telephony-escalation-lost">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              <span>У получателя «{overview.escalation.name}» больше нет права на телефонию. Выберите другого.</span>
            </p>
          ) : null}
        </Row>
      </fieldset>

      {readOnly ? (
        <p className="mt-2 flex items-start gap-1.5 border-t border-border pt-4 t-body-compact text-fg-2">
          <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
          <span>В просмотре роли настройки не меняются. Выйдите из просмотра, чтобы править.</span>
        </p>
      ) : (
        <div className="mt-2 border-t border-border pt-5">
          {opening.length > 0 ? (
            <div className="mb-4" data-testid="v3-telephony-opening">
              <p className="t-body-compact text-fg">Это сохранение откроет:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 t-body-compact text-fg-2">
                {opening.map((key) => <li key={key}>{TELEPHONY_FLAG_COPY[key].opens}</li>)}
              </ul>
              <label className="mt-2 inline-flex min-h-11 items-center gap-2 t-body-compact text-fg">
                <input type="checkbox" checked={understood} onChange={(event) => setConfirmedKey(event.target.checked ? openingKey : "")} className="size-4 shrink-0 accent-[var(--text)]" />
                Понимаю и подтверждаю
              </label>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="submit" className={`${btnCls} ${SAVE_IDLE}`} disabled={pending} aria-disabled={!dirty || undefined}>
              {pending ? "Сохраняю…" : "Сохранить настройки"}
            </button>
            <p
              ref={statusRef}
              tabIndex={-1}
              role={result?.tone === "error" || (tried && issues.length > 0) ? "alert" : "status"}
              className={`t-body-compact outline-none ${result?.tone === "error" || (tried && issues.length > 0) ? "text-danger" : "text-fg-2"}`}
              data-testid="v3-telephony-settings-status"
            >
              {tried && issues.length > 0 ? "Проверьте отмеченные поля." : result ? result.text : dirty ? "Есть несохранённые изменения." : null}
            </p>
          </div>
        </div>
      )}
    </form>
  );
}
