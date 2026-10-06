import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls } from "@/components/ui";
import { StatusChip, type StatusChipTone } from "@/components/v3/blocks/StatusChip";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import { confirmAiRulesAction, recordAiConsentAction, retryAiDocumentAction } from "@/lib/platform-ai-agent-actions";
import type { AiAgentStatus } from "@/lib/server/ai-agent-route-handlers";
import {
  AI_AGENT_SECTIONS,
  AUDIENCE_LABEL,
  PURPOSE_GROUP_LABEL,
  RULE_SOURCE_LABEL,
  aiAgentHref,
  aiDateTime,
  aiErrorCopy,
  aiLongDate,
  documentStatus,
  formatUsd,
  type AiAgentSection,
  type AiDocument,
  type AiRules,
  type AiSettings,
  type AiSpend,
} from "@/lib/v3/ai-agent";
import type { AiRead } from "@/lib/v3/ai-agent-source";

import { AiActionForm } from "./AiActionForm";
import { AiMonthlyCapForm } from "./AiMonthlyCapForm";
import { AiRulesEditor } from "./AiRulesEditor";

/**
 * Раздел «ИИ-агент» (план ИИ-агента §12.2): вкладки P1 — «Информация для
 * агента», «Правила общения», «Расходы». Подразделов P2–P4 («Лист сверки»,
 * «Лаборатория», «Автоответчик», «Диктовка») здесь нет — без пустых кнопок.
 * Числа — из базы; не прочитано — «Не удалось загрузить», а не ноль.
 */
export function AiAgentNav({ section }: Readonly<{ section: AiAgentSection }>) {
  return (
    <QueueViewTabs
      label="Подразделы ИИ-агента"
      tabs={AI_AGENT_SECTIONS.map((tab) => ({
        key: tab.key, label: tab.title, count: null, current: tab.key === section, href: aiAgentHref(tab.key),
      }))}
    />
  );
}

export function AiUnavailable({ what, retryHref }: Readonly<{ what: string; retryHref: string }>) {
  return (
    <p role="alert" className="t-body-compact text-fg-2" data-testid="v3-ai-unavailable">
      Не удалось загрузить {what}.{" "}
      <a href={retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a>
    </p>
  );
}

function Line({ tone, children, testId }: Readonly<{ tone: "warn" | "muted"; children: ReactNode; testId?: string }>) {
  return (
    <p
      className={`flex items-start gap-2 rounded-card border px-4 py-3 t-body-compact ${tone === "warn" ? "border-transparent bg-warn-weak text-warn" : "border-border bg-surface text-fg-2"}`}
      data-testid={testId}
    >
      <Icon name={tone === "warn" ? "alert" : "settings"} size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Пока согласие на Gemini не записано: администратор видит карточку
 * «Включить ИИ-агента» с текстом согласия (Q4, §12.2), остальные — строку.
 * Без секрета агента на сервере — честная строка «не подключён».
 */
export function AiAgentNotice({
  settings,
  featureOn,
  preview,
  consentRequestId,
}: Readonly<{ settings: AiSettings | null; featureOn: boolean; preview: boolean; consentRequestId: string }>) {
  const consent = settings?.consent.recorded ?? true;
  return (
    <>
      {!featureOn ? (
        <Line tone="muted" testId="v3-ai-feature-off">
          ИИ-агент не подключён к CRM на сервере — окно «Помочь с ответом» в чате пока не готовит ответы. Подключает администратор.
        </Line>
      ) : null}
      {!consent && settings?.isAdmin && !preview ? (
        <section className="rounded-card border border-border bg-surface px-4 py-4 sm:px-5" aria-labelledby="ai-consent-title" data-testid="v3-ai-consent">
          <h2 id="ai-consent-title" className="t-section text-fg">Включить ИИ-агента</h2>
          <div className="mt-2 max-w-[70ch] space-y-2 t-body-compact text-fg-2">
            <p>
              ИИ-агент готовит черновики ответов в чате продаж с помощью Google Gemini (платный проект Google Cloud EVO).
              Для этого в Gemini передаются последние 20 сообщений диалога, имя, интерес и этап лида и материалы
              «Информации для агента». Телефон, email и документы клиентов не передаются.
            </p>
            <p>Отправляет ответ всегда сотрудник. Согласие записывается в журнал с вашим именем; отозвать его можно в «Расходах».</p>
          </div>
          <div className="mt-4">
            <AiActionForm
              requestId={consentRequestId}
              action={recordAiConsentAction}
              fields={{ consent_action: "grant" }}
              label="Включить ИИ-агента"
              pendingLabel="Записываю согласие…"
              buttonClassName={btnCls}
              messages={{ saved: "Согласие записано. ИИ-агент включён.", forbidden: "Согласие записывает только администратор." }}
              testId="v3-ai-consent-form"
            />
          </div>
        </section>
      ) : null}
      {!consent && (!settings?.isAdmin || preview) ? (
        <Line tone="warn" testId="v3-ai-consent-wait">
          ИИ-агента включает администратор: до этого окно «Помочь с ответом» в чате не готовит ответы.
        </Line>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------- документы

const KIND_LABEL: Readonly<Record<string, string>> = {
  knowledge: "страница", text: "текст", docx: "DOCX", xlsx: "XLSX", csv: "CSV", pdf: "PDF", image: "скан",
};
const STATUS_TONE: Readonly<Record<string, StatusChipTone>> = { ok: "ok", warn: "warn", danger: "danger", muted: "neutral" };

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100, ones = count % 10;
  return `${count.toLocaleString("ru-RU")} ${tens >= 11 && tens <= 14 ? many : ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many}`;
}

function sourceLine(document: AiDocument): string {
  const kind = KIND_LABEL[document.kind] ?? document.kind;
  const from = document.source === "seed_kb"
    ? `«База знаний»${document.sourceNodeVersion !== null ? `, версия ${document.sourceNodeVersion}` : ""}`
    : document.source === "lab" ? "Лаборатория" : "загружен";
  return [kind, from, document.editedInLab ? "изменён в Лаборатории" : null].filter(Boolean).join(" · ");
}

export function AiDocumentsView({
  read,
  preview,
  requestIds,
  retryHref,
}: Readonly<{
  read: AiRead<Readonly<{ items: readonly AiDocument[]; hasMore: boolean; canManage: boolean; isAdmin: boolean }>>;
  preview: boolean;
  /** Id запроса «Повторить» для каждого документа с ошибкой — с сервера. */
  requestIds: Readonly<Record<string, string>>;
  retryHref: string;
}>) {
  if (read.status !== "available") return <AiUnavailable what="материалы агента" retryHref={retryHref} />;
  const { items, hasMore, canManage } = read.data;
  if (items.length === 0) {
    return (
      <section className="rounded-card border border-border bg-surface px-4 py-8 text-center" data-testid="v3-ai-documents-empty">
        <p className="t-section text-fg">Материалов пока нет</p>
        <p className="mx-auto mt-1 max-w-[52ch] t-body-compact text-fg-2">
          Начальные материалы администратор копирует из «Базы знаний»; загрузка файлов появится позже.
        </p>
      </section>
    );
  }
  const client = items.filter((item) => item.audience === "client").length;
  const ready = items.filter((item) => item.status === "ready" || item.status === "review").length;
  return (
    <section aria-labelledby="ai-documents-title" className="space-y-3" data-testid="v3-ai-documents">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="ai-documents-title" className="t-section text-fg">Материалы агента</h2>
        <p className="t-meta tabular-nums text-fg-3">
          {plural(items.length, "документ", "документа", "документов")} · для клиентов {client} · внутренних {items.length - client} · готовы {ready}
        </p>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {items.map((document) => {
          const status = documentStatus(document);
          return (
            <li
              key={document.id}
              className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              data-testid="v3-ai-document"
              data-status={document.status}
            >
              <div className="min-w-0">
                <p className="t-item break-words text-fg">{document.title}</p>
                <p className="mt-0.5 t-meta text-fg-3">
                  {sourceLine(document)}
                  {document.chunkCount > 0 ? ` · ${plural(document.chunkCount, "фрагмент", "фрагмента", "фрагментов")}` : ""}
                  {` · ${aiDateTime(document.updatedAt)}`}
                </p>
                {document.status === "failed" && document.errorCode ? (
                  <p className="mt-0.5 t-meta text-danger">Код ошибки: <span className="font-mono">{document.errorCode}</span></p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                <StatusChip label={AUDIENCE_LABEL[document.audience]} tone={document.audience === "internal" ? "info" : "neutral"} />
                <StatusChip label={status.label} tone={STATUS_TONE[status.tone]} />
                {document.openReviewCount > 0 ? (
                  <StatusChip label={`сверка: ${document.openReviewCount}`} tone="warn" />
                ) : null}
                {document.status === "failed" && canManage && !preview && requestIds[document.id] ? (
                  <AiActionForm
                    requestId={requestIds[document.id]}
                    action={retryAiDocumentAction}
                    fields={{ document_id: document.id, expected_version: String(document.rowVersion) }}
                    label="Повторить"
                    pendingLabel="Ставлю в очередь…"
                    buttonClassName={btnGhostCls}
                    messages={{ saved: "Документ снова в очереди." }}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore ? <p className="t-meta text-fg-3">Показаны первые 100 документов.</p> : null}
    </section>
  );
}

// ------------------------------------------------------------- правила

export function AiRulesView({
  read,
  preview,
  editorRequestId,
  confirmRequestId,
  retryHref,
}: Readonly<{ read: AiRead<AiRules>; preview: boolean; editorRequestId: string; confirmRequestId: string; retryHref: string }>) {
  if (read.status !== "available") return <AiUnavailable what="«Правила общения»" retryHref={retryHref} />;
  const { current, versions } = read.data;
  const canManage = read.data.canManage && !preview;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="ai-rules-title" className="min-w-0 space-y-3" data-testid="v3-ai-rules">
        <div className="space-y-1">
          <h2 id="ai-rules-title" className="t-section text-fg">
            {current ? `Версия ${current.version}` : "Правил пока нет"}
          </h2>
          {current ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="t-meta text-fg-3">
                {RULE_SOURCE_LABEL[current.source]}
                {current.createdByName ? ` · ${current.createdByName}` : ""} · {aiDateTime(current.createdAt)}
              </p>
              {current.needsReview ? (
                <StatusChip label="нужна проверка" tone="warn" />
              ) : (
                <StatusChip label={`проверено${current.confirmedByName ? ` · ${current.confirmedByName}` : ""}`} tone="ok" />
              )}
              {current.needsReview && canManage ? (
                <AiActionForm
                  requestId={confirmRequestId}
                  action={confirmAiRulesAction}
                  fields={{ rules_version_id: current.id }}
                  label="Проверено"
                  pendingLabel="Отмечаю…"
                  buttonClassName={btnGhostCls}
                  messages={{ saved: "Версия отмечена проверенной.", conflict: "Эту версию уже проверили — обновите страницу." }}
                  testId="v3-ai-rules-confirm"
                />
              ) : null}
            </div>
          ) : (
            <p className="t-body-compact text-fg-2">Агент отвечает только по постоянным правилам ответа, пока здесь нет текста.</p>
          )}
        </div>
        {canManage ? (
          <AiRulesEditor initialBody={current?.body ?? ""} expectedVersion={current?.version ?? null} requestId={editorRequestId} />
        ) : current ? (
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-card border border-border bg-surface px-4 py-3 font-sans t-body text-fg">
            {current.body}
          </pre>
        ) : null}
      </section>
      <section aria-labelledby="ai-rules-history" className="min-w-0" data-testid="v3-ai-rules-history">
        <h2 id="ai-rules-history" className="t-section text-fg">История версий</h2>
        {versions.length === 0 ? (
          <p className="mt-1 t-body-compact text-fg-3">Версий пока нет.</p>
        ) : (
          <ol className="mt-2 divide-y divide-border rounded-card border border-border bg-surface">
            {versions.map((version) => (
              <li key={version.id} className="px-3 py-2.5">
                <p className="flex flex-wrap items-center gap-x-2 t-item text-fg">
                  Версия {version.version}
                  {version.current ? <StatusChip label="текущая" tone="neutral" /> : null}
                </p>
                <p className="t-meta text-fg-3">
                  {RULE_SOURCE_LABEL[version.source]}{version.createdByName ? ` · ${version.createdByName}` : ""} · {aiDateTime(version.createdAt)}
                </p>
                <p className="t-meta text-fg-3">
                  {version.confirmedAt ? `проверено ${aiDateTime(version.confirmedAt)}` : "не проверена"} · {(version.bytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------- расходы

const KIND_WORD: Readonly<Record<string, string>> = { input: "вход", output: "выход", cached: "кэш", audio_input: "аудио", embedding: "эмбеддинги" };

function priceNotes(spend: AiSpend): readonly string[] {
  const byDay = new Map<string, Map<string, string[]>>();
  for (const change of spend.priceChanges) {
    const models = byDay.get(change.effectiveFrom) ?? new Map<string, string[]>();
    const parts = models.get(change.model) ?? [];
    const was = change.previousUsdPerMillion;
    parts.push(`${KIND_WORD[change.kind] ?? change.kind} ${was !== null ? `${formatUsd(was)} → ` : ""}${formatUsd(change.usdPerMillion)}`);
    models.set(change.model, parts);
    byDay.set(change.effectiveFrom, models);
  }
  return [...byDay.entries()].map(([day, models]) =>
    `С ${aiLongDate(day)} меняются цены Gemini за 1 млн токенов: ${[...models.entries()].map(([model, parts]) => `${model} — ${parts.join(", ")}`).join("; ")}.`);
}

function Figure({ label, value, meta, testId }: Readonly<{ label: string; value: string; meta?: string | null; testId?: string }>) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3" data-testid={testId}>
      <dt className="t-caption text-fg-3">{label}</dt>
      <dd className="mt-1 t-figure tabular-nums text-fg">{value}</dd>
      {meta ? <dd className="mt-0.5 t-meta text-fg-3">{meta}</dd> : null}
    </div>
  );
}

function agentStatusLine(status: AiAgentStatus): Readonly<{ tone: "ok" | "warn" | "muted"; text: string }> {
  if (status.state === "off") return { tone: "muted", text: "ИИ-агент не подключён к CRM на сервере." };
  if (status.state === "unavailable") return { tone: "warn", text: aiErrorCopy("agent_unavailable") };
  if (status.block) return { tone: "warn", text: aiErrorCopy(status.block) };
  return status.keyAccepted
    ? { tone: "ok", text: `Gemini принимает ключ EVO${status.model ? ` · модель ${status.model}` : ""}.` }
    : { tone: "warn", text: "Gemini не принял ключ EVO — проверьте ключ в Google Cloud." };
}

export function AiSpendView({
  spend,
  settings,
  agentStatus,
  preview,
  capRequestId,
  revokeRequestId,
  retryHref,
}: Readonly<{
  spend: AiRead<AiSpend>;
  settings: AiRead<AiSettings>;
  agentStatus: AiAgentStatus;
  preview: boolean;
  capRequestId: string;
  revokeRequestId: string;
  retryHref: string;
}>) {
  const status = agentStatusLine(agentStatus);
  return (
    <div className="space-y-6">
      {spend.status !== "available" ? <AiUnavailable what="расходы" retryHref={retryHref} /> : (() => {
        const data = spend.data;
        const groups = [...data.byGroup].sort((left, right) => right.usd - left.usd);
        const anyEstimated = data.monthEstimated || groups.some((group) => group.estimated);
        const notes = priceNotes(data);
        const used = data.monthlyCapUsd > 0 ? Math.min(100, Math.round(((data.monthUsd + data.reservedUsd) / data.monthlyCapUsd) * 100)) : null;
        return (
          <>
            <section aria-labelledby="ai-spend-title" className="space-y-3" data-testid="v3-ai-spend">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="ai-spend-title" className="t-section text-fg">Расходы на ИИ</h2>
                <p className="t-meta text-fg-3">В долларах, день — по Бишкеку, с {aiLongDate(data.monthStart)}</p>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border lg:grid-cols-4">
                <Figure label="Сегодня" value={formatUsd(data.todayUsd)} testId="v3-ai-spend-today" />
                <Figure label="Этот месяц" value={formatUsd(data.monthUsd, data.monthEstimated)} meta={data.reservedUsd > 0 ? `и в работе ${formatUsd(data.reservedUsd)}` : null} />
                <Figure label="Прогноз на месяц" value={formatUsd(data.forecastUsd, data.monthEstimated)} meta="по темпу этого месяца" />
                <Figure
                  label="Лимит на месяц"
                  value={formatUsd(data.monthlyCapUsd)}
                  meta={data.monthlyCapUsd > 0 ? `осталось ${formatUsd(data.remainingUsd)}${used !== null ? ` · занято ${used}%` : ""}` : "ИИ-вызовы отклоняются"}
                />
              </dl>
              <p className="t-body-compact text-fg-2" data-testid="v3-ai-spend-answer">
                {data.answers > 0 && data.averageAnswerUsd !== null
                  ? <>Средняя цена ответа — <span className="tabular-nums text-fg">{formatUsd(data.averageAnswerUsd, data.monthEstimated)}</span> · {plural(data.answers, "ответ", "ответа", "ответов")} за месяц (с поиском).</>
                  : "Ответов в этом месяце ещё не было — средней цены нет."}
              </p>
            </section>

            <section aria-labelledby="ai-spend-purpose" className="space-y-2">
              <h2 id="ai-spend-purpose" className="t-section text-fg">По назначению</h2>
              {groups.length === 0 ? (
                <p className="t-body-compact text-fg-3">В этом месяце вызовов ещё не было.</p>
              ) : (
                <div className="overflow-x-auto rounded-card border border-border bg-surface" tabIndex={0} role="region" aria-label="Расходы по назначению">
                  <table className="w-full min-w-[20rem] border-collapse" data-testid="v3-ai-spend-groups">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className="px-4 py-2 text-left t-caption text-fg-2">Назначение</th>
                        <th scope="col" className="px-4 py-2 text-right t-caption text-fg-2">Вызовы</th>
                        <th scope="col" className="px-4 py-2 text-right t-caption text-fg-2">Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((group) => (
                        <tr key={group.group} className="border-b border-border last:border-b-0">
                          <th scope="row" className="px-4 py-2.5 text-left t-body-compact font-normal text-fg">{PURPOSE_GROUP_LABEL[group.group]}</th>
                          <td className="px-4 py-2.5 text-right t-body-compact tabular-nums text-fg-2">{group.calls.toLocaleString("ru-RU")}</td>
                          <td className="px-4 py-2.5 text-right t-body-compact tabular-nums text-fg">{formatUsd(group.usd, group.estimated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {anyEstimated ? (
                <p className="t-meta text-fg-3">≈ — оценка: эмбеддинги и прерванные вызовы Gemini не сообщают точные токены.</p>
              ) : null}
            </section>

            {notes.length > 0 ? (
              <section aria-label="Смена цен" className="space-y-1" data-testid="v3-ai-price-changes">
                {notes.map((note) => (
                  <p key={note} className="flex items-start gap-2 t-body-compact text-fg-2">
                    <Icon name="calendar" size={16} className="mt-0.5 shrink-0 text-fg-3" />
                    {note}
                  </p>
                ))}
              </section>
            ) : null}
          </>
        );
      })()}

      <section aria-labelledby="ai-settings-title" className="space-y-3 border-t border-border pt-5" data-testid="v3-ai-settings">
        <h2 id="ai-settings-title" className="t-section text-fg">Агент и лимит</h2>
        <p className={`flex items-start gap-2 t-body-compact ${status.tone === "ok" ? "text-ok" : status.tone === "warn" ? "text-warn" : "text-fg-2"}`} data-testid="v3-ai-agent-status">
          <Icon name={status.tone === "ok" ? "circle-check" : status.tone === "warn" ? "alert" : "lock"} size={16} className="mt-0.5 shrink-0" />
          {status.text}
        </p>
        {settings.status !== "available" ? <AiUnavailable what="настройки агента" retryHref={retryHref} /> : (() => {
          const data = settings.data;
          return (
            <>
              <dl className="grid gap-x-6 gap-y-1 t-body-compact sm:grid-cols-[max-content_minmax(0,1fr)]">
                <dt className="text-fg-3">Модель ответа</dt><dd className="font-mono text-fg">{data.models.answer}</dd>
                <dt className="text-fg-3">Быстрая модель</dt><dd className="font-mono text-fg">{data.models.fast}</dd>
                <dt className="text-fg-3">Эмбеддинги</dt><dd className="font-mono text-fg">{data.models.embedding}</dd>
                <dt className="text-fg-3">Лимит запросов</dt><dd className="text-fg">{data.ratePerMemberMinute} ответов в минуту на сотрудника</dd>
              </dl>
              {data.unpricedModels.length > 0 ? (
                <p className="flex items-start gap-2 rounded-card bg-warn-weak px-3 py-2 t-body-compact text-warn">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                  Нет цены на сегодня у {data.unpricedModels.join(", ")} — пока так, ИИ-вызовы отклоняются.
                </p>
              ) : null}
              {data.canManage && !preview ? (
                <AiMonthlyCapForm capUsd={data.monthlyCapUsd} expectedVersion={data.version} requestId={capRequestId} />
              ) : (
                <p className="t-body-compact text-fg-2">Месячный лимит — {formatUsd(data.monthlyCapUsd)}.</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 t-body-compact text-fg-2" data-testid="v3-ai-consent-line">
                <span>
                  {data.consent.recorded
                    ? `Согласие на передачу текстов в Gemini записано ${aiDateTime(data.consent.at)}${data.consent.byName ? ` · ${data.consent.byName}` : ""}.`
                    : "Согласие на передачу текстов в Gemini не записано."}
                </span>
                {data.consent.recorded && data.isAdmin && !preview ? (
                  <details className="group">
                    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg [&::-webkit-details-marker]:hidden">
                      Отозвать согласие
                    </summary>
                    <div className="pb-2">
                      <AiActionForm
                        requestId={revokeRequestId}
                        action={recordAiConsentAction}
                        fields={{ consent_action: "revoke" }}
                        label="Отозвать — ИИ перестанет готовить ответы"
                        pendingLabel="Отзываю…"
                        buttonClassName={btnGhostCls}
                        messages={{ saved: "Согласие отозвано. ИИ-вызовы отклоняются." }}
                      />
                    </div>
                  </details>
                ) : null}
              </div>
            </>
          );
        })()}
      </section>
    </div>
  );
}
