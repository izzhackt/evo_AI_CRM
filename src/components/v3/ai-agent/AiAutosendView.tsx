import Link from "next/link";

import { Icon } from "@/components/icons";
import { btnGhostCls } from "@/components/ui";
import { StatusChip, type StatusChipTone } from "@/components/v3/blocks/StatusChip";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import {
  pauseAiAutosendAction,
  saveAiAutosendSettingsAction,
  setAiAutosendModeAction,
  toggleAiAutosendAction,
} from "@/lib/platform-ai-agent-autosend-actions";
import { aiAgentHref, type AiAutosendRoute } from "@/lib/v3/ai-agent";
import {
  AI_AUTOSEND_COPY,
  AI_AUTOSEND_JOURNAL_FILTERS,
  AI_AUTOSEND_MODE_LABEL,
  AI_AUTOSEND_QUALIFICATION,
  AI_AUTOSEND_STATUS_LABEL,
  AI_AUTOSEND_STATUS_TONE,
  aiAutosendDate,
  aiAutosendDayTime,
  aiAutosendJournalReason,
  aiAutosendLiveLock,
  aiAutosendMode,
  aiAutosendNight,
  aiAutosendPauseReason,
  aiAutosendShortDayTime,
  aiAutosendTime,
  aiAutosendWindowLine,
  type AiAutosendJournal,
  type AiAutosendJournalRow,
  type AiAutosendState,
  type AiAutosendSummaryRead,
} from "@/lib/v3/ai-agent-autosend";
import type { AiRead } from "@/lib/v3/ai-agent-source";

import { AiActionForm } from "./AiActionForm";
import { AiUnavailable } from "./AiAgentViews";
import { AiAutosendModeSwitch } from "./AiAutosendModeSwitch";
import { AiAutosendSettingsForm } from "./AiAutosendSettingsForm";

export type AiAutosendRequestIds = Readonly<{ settings: string; toggle: string; mode: string; pause: string; resume: string }>;

const VIEW_TABS = Object.freeze([
  { key: "settings", label: "Настройки" },
  { key: "journal", label: "Журнал" },
  { key: "summary", label: "Утренняя сводка" },
] as const);

const textActionCls =
  "inline-flex min-h-11 items-center rounded-nav px-1.5 -mx-1.5 t-label text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg disabled:cursor-wait disabled:text-fg-3";

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10, mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${count} ${word}`;
}

/**
 * «Автоответчик на паузе: {причина} · Снять паузу» — над всем разделом
 * автоответчика; снять паузу может только человек (§11, правило 11).
 */
export function AiAutosendPauseBanner({
  state,
  preview,
  resumeRequestId,
  compactHref = null,
}: Readonly<{ state: AiAutosendState; preview: boolean; resumeRequestId: string; compactHref?: string | null }>) {
  if (!state.pause) return null;
  const since = state.pause.at ? aiAutosendDayTime(state.pause.at) : "";
  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card bg-warn-weak px-4 py-2.5 text-warn"
      aria-label={AI_AUTOSEND_COPY.pauseBanner}
      data-testid="v3-ai-autosend-pause-banner"
      data-code={state.pause.code}
    >
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-2 t-body-compact">
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">{AI_AUTOSEND_COPY.pauseBanner}:</span> {aiAutosendPauseReason(state.pause)}
          {since ? <span className="text-fg-2"> · с {since}</span> : null}
        </span>
      </p>
      {compactHref ? (
        <Link href={compactHref} className={`${textActionCls} text-fg`}>Открыть «{AI_AUTOSEND_COPY.title}»</Link>
      ) : !preview ? (
        <AiActionForm
          requestId={resumeRequestId}
          action={pauseAiAutosendAction}
          fields={{ pause_action: "resume", expected_version: String(state.version) }}
          label={AI_AUTOSEND_COPY.resume}
          pendingLabel="Снимаю паузу…"
          buttonClassName={QUEUE_CONFIRM}
          messages={{ saved: "Пауза снята.", forbidden: "Нет права снять паузу." }}
          testId="v3-ai-autosend-resume"
        />
      ) : null}
    </section>
  );
}

function modeTone(state: AiAutosendState): StatusChipTone {
  if (state.pause) return "warn";
  const mode = aiAutosendMode(state);
  return mode === "live" ? "ok" : mode === "shadow" ? "info" : "neutral";
}

/** Шапка: состояние словом, ответственный, интервал, выключатель, режим, пауза. */
function AiAutosendHeader({
  state,
  serverOn,
  preview,
  requestIds,
}: Readonly<{ state: AiAutosendState; serverOn: boolean; preview: boolean; requestIds: AiAutosendRequestIds }>) {
  const mode = aiAutosendMode(state);
  const chip = state.pause ? "На паузе" : AI_AUTOSEND_MODE_LABEL[mode];
  const enableBlocked = !state.consentRecorded ? AI_AUTOSEND_COPY.noConsent : !state.canSend ? AI_AUTOSEND_COPY.noSendRight : null;
  const sending = mode === "live" || (mode === "shadow" && state.settings.liveTestConversationIds.length > 0);
  return (
    <section aria-labelledby="ai-autosend-title" className="space-y-4 rounded-card border border-border bg-surface px-4 py-4 sm:px-6" data-testid="v3-ai-autosend-header" data-mode={mode}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 id="ai-autosend-title" className="t-section text-fg">{AI_AUTOSEND_COPY.title}</h2>
          <StatusChip label={chip} tone={modeTone(state)} />
        </div>
        {state.enabled ? (
          <>
            <p className="t-body-compact text-fg-2" data-testid="v3-ai-autosend-responsible">
              Ответственный: <span className="text-fg">{state.responsible?.name ?? "не назначен"}</span>
              {state.enabledAt ? <> · включён {aiAutosendDayTime(state.enabledAt)}</> : null}
            </p>
            <p className="t-body-compact text-fg-2" data-testid="v3-ai-autosend-window">{aiAutosendWindowLine(state)}</p>
          </>
        ) : null}
      </div>

      {state.enabled && !serverOn ? (
        <p
          className={`flex items-start gap-2 t-body-compact ${sending ? "text-warn" : "text-fg-2"}`}
          data-testid="v3-ai-autosend-server-off"
        >
          <Icon name={sending ? "alert" : "lock"} size={16} className="mt-0.5 shrink-0" />
          <span><span className="font-semibold">{AI_AUTOSEND_COPY.serverOff}</span>{sending ? " — ничего не уйдёт, пока её не включат на сервере." : "."}</span>
        </p>
      ) : null}

      {!state.enabled ? (
        <div className="space-y-2" data-testid="v3-ai-autosend-enable">
          <p className="max-w-[70ch] t-body-compact text-fg-2">{AI_AUTOSEND_COPY.firstEnable}</p>
          {preview ? null : enableBlocked ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" className={`${QUEUE_CONFIRM} cursor-not-allowed border-border bg-surface-2 text-fg-3 hover:border-border hover:bg-surface-2`}
                aria-disabled="true" aria-describedby="ai-autosend-enable-blocked">
                {AI_AUTOSEND_COPY.enable}
              </button>
              <p id="ai-autosend-enable-blocked" className="t-body-compact text-fg-2">{enableBlocked}</p>
            </div>
          ) : (
            <AiActionForm
              requestId={requestIds.toggle}
              action={toggleAiAutosendAction}
              fields={{ autosend_action: "enable", expected_version: String(state.version) }}
              label={AI_AUTOSEND_COPY.enable}
              pendingLabel="Включаю…"
              buttonClassName={QUEUE_CONFIRM}
              messages={{
                saved: "Автоответчик включён: «Проверка без отправки».",
                consent_required: AI_AUTOSEND_COPY.noConsent,
                forbidden: AI_AUTOSEND_COPY.noSendRight,
                conflict: `${AI_AUTOSEND_COPY.conflict}.`,
              }}
              testId="v3-ai-autosend-enable-form"
            />
          )}
        </div>
      ) : preview ? null : (
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <AiAutosendModeSwitch
            mode={state.shadowMode ? "shadow" : "live"}
            lock={aiAutosendLiveLock(state)}
            version={state.version}
            requestId={requestIds.mode}
            action={setAiAutosendModeAction}
          />
          <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
            {state.pause ? null : (
              <AiActionForm
                requestId={requestIds.pause}
                action={pauseAiAutosendAction}
                fields={{ pause_action: "pause", expected_version: String(state.version) }}
                label={AI_AUTOSEND_COPY.pause}
                pendingLabel="Ставлю паузу…"
                buttonClassName={btnGhostCls}
                messages={{ saved: "Автоответчик на паузе." }}
                testId="v3-ai-autosend-pause"
              />
            )}
            <details className="group" data-testid="v3-ai-autosend-disable">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg [&::-webkit-details-marker]:hidden">
                {AI_AUTOSEND_COPY.disable}
              </summary>
              <div className="max-w-xs space-y-1 pb-2">
                <p className="t-body-compact text-fg">{AI_AUTOSEND_COPY.disableConfirm}</p>
                <AiActionForm
                  requestId={requestIds.toggle}
                  action={toggleAiAutosendAction}
                  fields={{ autosend_action: "disable", expected_version: String(state.version) }}
                  label="Выключить"
                  pendingLabel="Выключаю…"
                  buttonClassName={btnGhostCls}
                  messages={{ saved: "Автоответчик выключен.", conflict: `${AI_AUTOSEND_COPY.conflict}.` }}
                />
              </div>
            </details>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ journal

function JournalRow({ row }: Readonly<{ row: AiAutosendJournalRow }>) {
  const reason = aiAutosendJournalReason(row);
  const meta = [
    row.kind === "final_phrase" ? "финальная фраза" : row.kind === "answer" ? "ответ" : null,
    row.mode === "live_test" ? "живой тест" : null,
    row.language && row.language !== "ru" ? row.language.toUpperCase() : null,
  ].filter(Boolean).join(" · ");
  return (
    <li className="grid gap-x-4 gap-y-1.5 px-4 py-3 @3xl:grid-cols-[6.5rem_minmax(0,11rem)_10.5rem_minmax(0,1fr)]" data-testid="v3-ai-autosend-journal-row" data-status={row.status}>
      <time dateTime={row.at} className="whitespace-nowrap font-mono t-meta text-fg-2 @3xl:pt-0.5">{aiAutosendShortDayTime(row.at)}</time>
      {row.conversationTitle ? (
        <Link href={`/v3/inbox?conversation=${row.conversationId}`} className="-my-3 flex min-h-11 min-w-0 items-center @3xl:-mt-3.5">
          <span className="truncate t-body-compact text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg">{row.conversationTitle}</span>
        </Link>
      ) : <span className="t-body-compact text-fg-3">Чат недоступен</span>}
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <StatusChip label={AI_AUTOSEND_STATUS_LABEL[row.status]} tone={AI_AUTOSEND_STATUS_TONE[row.status]} />
        {meta ? <span className="t-meta text-fg-3">{meta}</span> : null}
      </span>
      <div className="min-w-0 space-y-1">
        {reason ? <p className={`t-body-compact ${row.status === "failed" ? "text-danger" : "text-fg-2"}`}>{reason}</p> : null}
        {row.text ? (
          <p className="whitespace-pre-wrap break-words t-body-compact text-fg" lang={row.language ?? undefined}>{row.text}</p>
        ) : row.textHidden ? (
          <p className="t-meta text-fg-3">Текст виден тем, кто может читать этот чат.</p>
        ) : null}
      </div>
    </li>
  );
}

function AiAutosendJournalView({ read, route, retryHref }: Readonly<{ read: AiRead<AiAutosendJournal>; route: AiAutosendRoute; retryHref: string }>) {
  return (
    <section aria-label="Журнал решений" className="space-y-3" data-testid="v3-ai-autosend-journal">
      <nav aria-label="Фильтр журнала" className="flex flex-wrap gap-1">
        {AI_AUTOSEND_JOURNAL_FILTERS.map((filter) => (
          <Link
            key={filter.key}
            href={aiAgentHref("autosend", { view: "journal", status: filter.key === "all" ? null : filter.key })}
            aria-current={route.journalFilter === filter.key ? "page" : undefined}
            className="v3-choice inline-flex min-h-11 items-center rounded-nav px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg"
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      {read.status !== "available" ? <AiUnavailable what="журнал" retryHref={retryHref} /> : read.data.items.length === 0 ? (
        <p className="rounded-card border border-dashed border-border px-4 py-6 text-center t-body-compact text-fg-2">
          {route.journalFilter === "all" ? "Решений пока нет — первые появятся ночью, когда напишет клиент." : "Таких решений нет."}
        </p>
      ) : (
        <>
          <ol className="@container divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {read.data.items.map((row) => <JournalRow key={row.id} row={row} />)}
          </ol>
          {read.data.next ? <p className="t-meta text-fg-3">Показаны последние {read.data.items.length} решений.</p> : null}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ summary

function SummaryFigure({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="t-caption text-fg-2">{label}</dt>
      <dd className="mt-1 t-figure tabular-nums text-fg">{value.toLocaleString("ru-RU")}</dd>
    </div>
  );
}

function AiAutosendSummaryView({ read, retryHref }: Readonly<{ read: AiRead<AiAutosendSummaryRead>; retryHref: string }>) {
  if (read.status !== "available") return <AiUnavailable what="сводку" retryHref={retryHref} />;
  const summary = read.data.summary;
  if (!summary) {
    return (
      <p className="rounded-card border border-dashed border-border px-4 py-6 text-center t-body-compact text-fg-2" data-testid="v3-ai-autosend-summary-empty">
        Сводок пока нет — первая появится утром после первой ночи.
      </p>
    );
  }
  const shadow = summary.shadow;
  return (
    <section aria-labelledby="ai-autosend-summary-title" className="space-y-4" data-testid="v3-ai-autosend-summary" data-shadow={shadow || undefined}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id="ai-autosend-summary-title" className="t-section text-fg">
          Ночь {aiAutosendNight(summary.intervalStart)}, {aiAutosendTime(summary.intervalStart)}–{aiAutosendTime(summary.intervalEnd)}
        </h3>
        {shadow ? <StatusChip label={AI_AUTOSEND_MODE_LABEL.shadow} tone="info" /> : null}
        {summary.ready ? null : <StatusChip label="Собирается" tone="neutral" />}
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-4">
        <SummaryFigure label="Диалогов" value={summary.counts.conversations} />
        <SummaryFigure label="Сообщений рассмотрено" value={summary.counts.considered} />
        <SummaryFigure label={shadow ? "Ответил бы" : "Ответов"} value={summary.counts.answered} />
        <SummaryFigure label="Позвонить" value={summary.counts.finalPhrases} />
      </dl>
      {summary.items.length === 0 ? (
        <p className="t-body-compact text-fg-2">Ночью клиенты не писали.</p>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {summary.items.map((item, index) => {
            const qualification = AI_AUTOSEND_QUALIFICATION.filter(([key]) => item.qualification[key]);
            const counts = [
              plural(item.considered, "сообщение", "сообщения", "сообщений"),
              item.answered > 0 ? plural(item.answered, shadow ? "ответ бы" : "ответ", shadow ? "ответа бы" : "ответа", shadow ? "ответов бы" : "ответов") : null,
              item.finalPhrase ? "финальная фраза" : null,
            ].filter(Boolean).join(" · ");
            return (
              <li key={item.conversationId ?? `hidden-${index}`} className="grid gap-x-6 gap-y-2 px-4 py-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,14rem)]"
                data-testid="v3-ai-autosend-summary-item" data-hidden={item.hidden || undefined}>
                <div className="min-w-0">
                  {item.conversationId && item.conversationTitle ? (
                    <Link href={`/v3/inbox?conversation=${item.conversationId}`} className="-my-3 inline-flex min-h-11 items-center t-item text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg">
                      {item.conversationTitle}
                    </Link>
                  ) : <span className="t-item text-fg-3">Чат недоступен</span>}
                  <p className="mt-0.5 t-meta text-fg-2">{counts}</p>
                </div>
                <div className="min-w-0 space-y-2">
                  {item.hidden ? null : qualification.length > 0 ? (
                    <dl className="grid gap-x-4 gap-y-0.5 t-body-compact sm:grid-cols-[max-content_minmax(0,1fr)]">
                      {qualification.map(([key, label]) => (
                        <div key={key} className="contents">
                          <dt className="text-fg-3">{label}</dt>
                          <dd className="min-w-0 break-words text-fg">{item.qualification[key]}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : <p className="t-body-compact text-fg-3">Квалификация не собрана.</p>}
                  {item.reasons.length > 0 ? (
                    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 t-meta text-fg-2" aria-label="Причины решений">
                      {item.reasons.map((reason) => (
                        <li key={reason.ru}>{reason.ru}{reason.count > 1 ? <span className="tabular-nums text-fg-3"> ×{reason.count}</span> : null}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="min-w-0 t-body-compact">
                  {item.callDate ? (
                    <p className="flex items-start gap-1.5 text-fg">
                      <Icon name="phone" size={16} className="mt-0.5 shrink-0 text-fg-3" />
                      <span>
                        Позвонить {aiAutosendDate(item.callDate)}
                        {item.taskId ? (
                          <> · <Link href={`/v3/tasks?task=${item.taskId}`} className="-my-3 inline-flex min-h-11 items-center underline decoration-fg-3 underline-offset-4 hover:decoration-fg">задача</Link></>
                        ) : item.taskSkipped ? <span className="text-fg-3"> · задача не создана</span> : null}
                      </span>
                    </p>
                  ) : item.hidden ? null : <p className="text-fg-3">Звонок не назначен</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ page

/**
 * «ИИ-агент → Автоответчик» (план §11, §12.2; ADR 0031). Наверху — пауза и
 * выключенная отправка на сервере, затем шапка (состояние, ответственный,
 * интервал, выключатель и режим), ниже — вкладки «Настройки», «Журнал»,
 * «Утренняя сводка». Всё решает база (277); раздел ничего не отправляет.
 */
export function AiAutosendView({
  read,
  route,
  journal,
  summary,
  serverOn,
  preview,
  retryHref,
  requestIds,
}: Readonly<{
  read: AiRead<AiAutosendState>;
  route: AiAutosendRoute;
  journal: AiRead<AiAutosendJournal> | null;
  summary: AiRead<AiAutosendSummaryRead> | null;
  serverOn: boolean;
  preview: boolean;
  retryHref: string;
  requestIds: AiAutosendRequestIds;
}>) {
  if (read.status !== "available") return <AiUnavailable what="автоответчик" retryHref={retryHref} />;
  const state = read.data;
  // Просмотр роли и сотрудник без ai.agent.manage видят всё, но ничего не меняют.
  const readOnly = preview || !state.canManage;
  return (
    <div className="space-y-5" data-testid="v3-ai-autosend" data-read-only={readOnly || undefined}>
      <AiAutosendPauseBanner state={state} preview={readOnly} resumeRequestId={requestIds.resume} />
      <AiAutosendHeader state={state} serverOn={serverOn} preview={readOnly} requestIds={requestIds} />
      <QueueViewTabs
        label="Автоответчик"
        tabs={VIEW_TABS.map((tab) => ({
          key: tab.key, label: tab.label, count: null, current: tab.key === route.view,
          href: aiAgentHref("autosend", tab.key === "settings" ? {} : { view: tab.key }),
        }))}
      />
      {route.view === "journal" && journal ? <AiAutosendJournalView read={journal} route={route} retryHref={retryHref} />
        : route.view === "summary" && summary ? <AiAutosendSummaryView read={summary} retryHref={retryHref} />
          : (
            <AiAutosendSettingsForm
              initial={state.settings}
              version={state.version}
              liveTestTitles={state.liveTestTitles}
              readOnly={readOnly}
              requestId={requestIds.settings}
              action={saveAiAutosendSettingsAction}
            />
          )}
    </div>
  );
}
