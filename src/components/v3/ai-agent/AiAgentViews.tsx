import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls } from "@/components/ui";
import { StatusChip, type StatusChipTone } from "@/components/v3/blocks/StatusChip";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import {
  confirmAiDocumentCompanyAction,
  confirmAiRulesAction,
  deleteAiDocumentAction,
  recordAiConsentAction,
  retryAiDocumentAction,
  saveAiMemoryAction,
} from "@/lib/platform-ai-agent-actions";
import type { AiAgentStatus } from "@/lib/server/ai-agent-route-handlers";
import {
  AI_AGENT_SECTIONS,
  AI_PERSONAL_DOCUMENT_CODE,
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
import { AI_MEMORY_SETTINGS_COPY } from "@/lib/v3/ai-agent-memory";
import type { AiRead } from "@/lib/v3/ai-agent-source";

import { AiActionForm } from "./AiActionForm";
import { AiMemoryToggle } from "./AiMemoryToggle";
import { AiDocumentUpload } from "./AiDocumentUpload";
import { AiMonthlyCapForm } from "./AiMonthlyCapForm";
import { AiRowMore } from "./AiRowMore";
import { AiRulesEditor } from "./AiRulesEditor";

/**
 * Раздел «ИИ-агент» (план ИИ-агента §12.2): вкладки «Информация для агента»,
 * «Лист сверки» (с числом открытых пунктов), «Лаборатория» (P2), «Правила
 * общения», «Расходы». «Автоответчика» и «Диктовки» (P4) здесь нет — без
 * пустых кнопок. Числа — из базы; не прочитано — без числа, а не ноль.
 */
export function AiAgentNav({ section, reviewOpenCount }: Readonly<{ section: AiAgentSection; reviewOpenCount: number | null }>) {
  return (
    <QueueViewTabs
      label="Подразделы ИИ-агента"
      tabs={AI_AGENT_SECTIONS.map((tab) => ({
        key: tab.key, label: tab.title, count: tab.key === "review" ? reviewOpenCount : null,
        current: tab.key === section, href: aiAgentHref(tab.key),
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

/** Id запросов команд строк — с сервера (одна разметка на сервере и при гидратации). */
export type AiDocumentRequestIds = Readonly<{
  upload: string;
  retry: Readonly<Record<string, string>>;
  remove: Readonly<Record<string, string>>;
  company: Readonly<Record<string, string>>;
}>;

const LIVE = new Set(["ready", "review"]);

/**
 * Новые версии лежат под своей прежней (§7: «старая версия ищется, пока
 * новая не готова»): строка прежней говорит «Новая версия обрабатывается —
 * пока ищется прежняя», а сама новая версия — строкой под ней.
 */
function groupVersions(items: readonly AiDocument[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const successors = new Map<string, AiDocument>();
  for (const item of items) {
    const previous = item.replacesId ? byId.get(item.replacesId) : undefined;
    if (previous && LIVE.has(previous.status) && !LIVE.has(item.status)) successors.set(previous.id, item);
  }
  const nested = new Set([...successors.values()].map((item) => item.id));
  return { rows: items.filter((item) => !nested.has(item.id)), successors };
}

function DeleteDocument({ document, requestId, label }: Readonly<{ document: AiDocument; requestId: string; label: string }>) {
  return (
    <AiActionForm
      requestId={requestId}
      action={deleteAiDocumentAction}
      fields={{ document_id: document.id, expected_version: String(document.rowVersion) }}
      label={label}
      pendingLabel="Удаляю…"
      buttonClassName={btnGhostCls}
      messages={{ saved: "Документ удалён.", conflict: "Документ уже изменился — обновите страницу." }}
    />
  );
}

/**
 * Команды строки на виду — только те, что ждут сотрудника: «Повторить» у
 * ошибки, «Это материал компании — продолжить» и «Удалить…» у документа,
 * похожего на документ клиента. Редкое («Новая версия», «Удалить…») — в «⋯».
 */
function PrimaryCommands({ document, requestIds }: Readonly<{ document: AiDocument; requestIds: AiDocumentRequestIds }>) {
  const personal = document.status === "failed" && document.errorCode === AI_PERSONAL_DOCUMENT_CODE;
  if (document.status !== "failed") return null;
  const fields = { document_id: document.id, expected_version: String(document.rowVersion) };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {personal && requestIds.company[document.id] ? (
        <AiActionForm
          requestId={requestIds.company[document.id]!}
          action={confirmAiDocumentCompanyAction}
          fields={fields}
          label="Это материал компании — продолжить"
          pendingLabel="Записываю решение…"
          buttonClassName={btnGhostCls}
          messages={{ saved: "Решение записано — обработка продолжается.", conflict: "Документ уже изменился — обновите страницу." }}
          testId="v3-ai-document-company"
        />
      ) : null}
      {!personal && requestIds.retry[document.id] ? (
        <AiActionForm
          requestId={requestIds.retry[document.id]!}
          action={retryAiDocumentAction}
          fields={fields}
          label="Повторить"
          pendingLabel="Ставлю в очередь…"
          buttonClassName={btnGhostCls}
          messages={{ saved: "Документ снова в очереди." }}
        />
      ) : null}
      {requestIds.remove[document.id] ? (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg-2 underline decoration-fg-3 underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden">
            Удалить…
          </summary>
          <div className="pb-1">
            <DeleteDocument document={document} requestId={requestIds.remove[document.id]!} label={personal ? "Удалить файл" : "Удалить документ"} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DocumentRow({
  document,
  successor,
  canManage,
  requestIds,
}: Readonly<{ document: AiDocument; successor: AiDocument | null; canManage: boolean; requestIds: AiDocumentRequestIds }>) {
  const status = documentStatus(document);
  const personal = document.status === "failed" && document.errorCode === AI_PERSONAL_DOCUMENT_CODE;
  const pending = successor !== null && successor.status !== "failed";
  const successorStatus = successor ? documentStatus(successor) : null;
  // Новая версия — только у загруженного файла (271: у знаний из «Базы знаний» её нет).
  const allowNewVersion = document.source === "upload" && LIVE.has(document.status) && successor === null;
  const menu = canManage && document.status !== "failed" && requestIds.remove[document.id] ? (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {allowNewVersion ? (
        <Link href={aiAgentHref("documents", { replace: document.id })} className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4">
          Загрузить новую версию
        </Link>
      ) : null}
      <DeleteDocument document={document} requestId={requestIds.remove[document.id]!} label="Удалить — агент перестанет его использовать" />
    </div>
  ) : null;
  return (
    <li className="px-4 py-3" data-testid="v3-ai-document" data-status={document.status} data-document-id={document.id}>
      <AiRowMore
        label={document.title}
        panel={menu}
        main={(
          <>
            <p className="t-item break-words text-fg">
              <Link href={aiAgentHref("documents", { document: document.id })} className="underline decoration-border-strong underline-offset-4 hover:decoration-fg">
                {document.title}
              </Link>
            </p>
            <p className="mt-0.5 t-meta text-fg-3">
              {sourceLine(document)}
              {document.pageCount !== null && document.pageCount > 0 ? ` · ${plural(document.pageCount, "страница", "страницы", "страниц")}` : ""}
              {document.chunkCount > 0 ? ` · ${plural(document.chunkCount, "фрагмент", "фрагмента", "фрагментов")}` : ""}
              {` · ${aiDateTime(document.updatedAt)}`}
            </p>
            {personal ? (
              <p className="mt-1 max-w-[64ch] t-body-compact text-fg-2">
                В тексте есть признаки паспорта, ПИН или бланка аттестата. Документы клиентов агенту не загружаются — продолжайте, только если это материал компании.
              </p>
            ) : null}
            {document.status === "failed" && !personal && document.errorCode ? (
              <p className="mt-0.5 t-meta text-fg-3">Код: <span className="font-mono">{document.errorCode}</span></p>
            ) : null}
            {canManage ? <PrimaryCommands document={document} requestIds={requestIds} /> : null}
          </>
        )}
        aside={(
          <>
            <StatusChip label={AUDIENCE_LABEL[document.audience]} tone={document.audience === "internal" ? "info" : "neutral"} />
            {document.status === "review" && document.openReviewCount > 0 ? (
              <Link href={aiAgentHref("review", { document: document.id })} className="inline-flex min-h-11 items-center rounded-full focus-visible:outline-offset-2" aria-label={`${status.label} — открыть «Лист сверки»`}>
                <StatusChip label={status.label} tone="warn" />
              </Link>
            ) : (
              <StatusChip label={status.label} tone={STATUS_TONE[status.tone]} />
            )}
          </>
        )}
      />
      {successor && successorStatus ? (
        <div className="mt-2 rounded-ctl bg-bg px-3 py-2" data-testid="v3-ai-document-successor" data-status={successor.status}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="min-w-0 t-body-compact text-fg-2">
              {pending ? "Новая версия обрабатывается — пока ищется прежняя." : "Новая версия не обработана — ищется прежняя."}
              <span className="t-meta text-fg-3"> · {aiDateTime(successor.updatedAt)}</span>
            </p>
            <StatusChip label={successorStatus.label} tone={STATUS_TONE[successorStatus.tone]} />
          </div>
          {canManage ? <PrimaryCommands document={successor} requestIds={requestIds} /> : null}
        </div>
      ) : null}
    </li>
  );
}

export function AiDocumentsView({
  read,
  preview,
  requestIds,
  retryHref,
  replaceId,
  featureOn,
}: Readonly<{
  read: AiRead<Readonly<{ items: readonly AiDocument[]; hasMore: boolean; canManage: boolean; isAdmin: boolean }>>;
  preview: boolean;
  requestIds: AiDocumentRequestIds;
  retryHref: string;
  /** «Новая версия» этого документа (`?replace=`). */
  replaceId: string | null;
  featureOn: boolean;
}>) {
  if (read.status !== "available") return <AiUnavailable what="материалы агента" retryHref={retryHref} />;
  const { items, hasMore } = read.data;
  const canManage = read.data.canManage && !preview;
  const replaceTarget = replaceId
    ? items.find((item) => item.id === replaceId && item.source === "upload" && LIVE.has(item.status)
      && !items.some((other) => other.replacesId === item.id && !LIVE.has(other.status) && other.status !== "superseded")) ?? null
    : null;
  const upload = canManage ? (
    <AiDocumentUpload
      key={replaceTarget?.id ?? "new"}
      requestId={requestIds.upload}
      replace={replaceTarget ? {
        id: replaceTarget.id, title: replaceTarget.title, rowVersion: replaceTarget.rowVersion,
        audienceLabel: AUDIENCE_LABEL[replaceTarget.audience],
      } : null}
      cancelHref={aiAgentHref("documents")}
      featureOn={featureOn}
    />
  ) : null;
  const staleReplace = replaceId !== null && replaceTarget === null ? (
    <p role="alert" className="t-body-compact text-fg-2">
      Новую версию этого документа загрузить нельзя: он уже заменён, удалён или ещё не готов.{" "}
      <Link href={aiAgentHref("documents")} className="inline-flex min-h-11 items-center underline underline-offset-4">К материалам</Link>
    </p>
  ) : null;
  if (items.length === 0) {
    return (
      <div className="space-y-4">
        {upload}
        <section className="rounded-card border border-border bg-surface px-4 py-8 text-center" data-testid="v3-ai-documents-empty">
          <p className="t-section text-fg">Материалов пока нет</p>
          <p className="mx-auto mt-1 max-w-[52ch] t-body-compact text-fg-2">
            {canManage
              ? "Загрузите прайс, буклет или правила компании — агент будет отвечать по ним и ссылаться на страницу."
              : "Материалы загружает сотрудник с доступом к «ИИ-агенту»."}
          </p>
        </section>
      </div>
    );
  }
  const { rows, successors } = groupVersions(items);
  const live = items.filter((item) => LIVE.has(item.status));
  const client = live.filter((item) => item.audience === "client").length;
  return (
    <div className="space-y-4">
      {staleReplace}
      {upload}
      <section aria-labelledby="ai-documents-title" className="space-y-3" data-testid="v3-ai-documents">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="ai-documents-title" className="t-section text-fg">Материалы агента</h2>
          <p className="t-meta tabular-nums text-fg-3">
            {plural(rows.length, "документ", "документа", "документов")} · ищутся {live.length} · для клиентов {client} · внутренних {live.length - client}
          </p>
        </div>
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {rows.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              successor={successors.get(document.id) ?? null}
              canManage={canManage}
              requestIds={requestIds}
            />
          ))}
        </ul>
        {hasMore ? <p className="t-meta text-fg-3">Показаны первые 100 документов.</p> : null}
      </section>
    </div>
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
  memoryRequestId,
  retryHref,
}: Readonly<{
  spend: AiRead<AiSpend>;
  settings: AiRead<AiSettings>;
  agentStatus: AiAgentStatus;
  preview: boolean;
  capRequestId: string;
  revokeRequestId: string;
  memoryRequestId: string;
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
                    {/* Отзыв (274) ещё и выключает память и удаляет сводки всех клиентов; новое согласие её не включает. */}
                    <div className="space-y-1 pb-2" data-testid="v3-ai-consent-revoke">
                      {data.memoryEnabled ? (
                        <p className="max-w-[70ch] text-pretty t-body-compact text-fg">{AI_MEMORY_SETTINGS_COPY.revokeConfirm}</p>
                      ) : null}
                      <AiActionForm
                        requestId={revokeRequestId}
                        action={recordAiConsentAction}
                        fields={{ consent_action: "revoke" }}
                        label={data.memoryEnabled ? AI_MEMORY_SETTINGS_COPY.revokeSubmit : "Отозвать — ИИ перестанет готовить ответы"}
                        pendingLabel="Отзываю…"
                        buttonClassName={btnGhostCls}
                        messages={{ saved: data.memoryEnabled ? AI_MEMORY_SETTINGS_COPY.revoked : "Согласие отозвано. ИИ-вызовы отклоняются." }}
                      />
                    </div>
                  </details>
                ) : null}
              </div>
              <AiMemorySettings settings={data} preview={preview} requestId={memoryRequestId} />
            </>
          );
        })()}
      </section>
    </div>
  );
}

/**
 * «Память о клиенте» (P3, план §9; Q9 — включает и выключает любой сотрудник
 * с ai.agent.manage, Q12 — без согласия на Gemini не включается). Выключение
 * удаляет сводки всех клиентов — поэтому подтверждение раскрытием, как у
 * отзыва согласия. Кнопки тихие: у «Расходов» нет красного действия.
 * Переключатель — один клиентский компонент на оба положения (`AiMemoryToggle`):
 * итог записи переживает перерисовку страницы.
 */
function AiMemorySettings({ settings, preview, requestId }: Readonly<{ settings: AiSettings; preview: boolean; requestId: string }>) {
  const copy = AI_MEMORY_SETTINGS_COPY;
  const enabled = settings.memoryEnabled;
  const consent = settings.consent.recorded;
  return (
    <section
      id="ai-memory"
      className="scroll-mt-20 space-y-2 border-t border-border pt-4"
      aria-labelledby="ai-memory-title"
      data-testid="v3-ai-memory-settings"
      data-enabled={enabled}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id="ai-memory-title" className="t-item text-fg">{copy.title}</h3>
        <StatusChip label={enabled ? copy.on : copy.off} tone={enabled ? "ok" : "neutral"} />
      </div>
      <p className="max-w-[70ch] text-pretty t-body-compact text-fg-2">{copy.about}</p>
      {/* Защитное: в 274 отзыв согласия выключает память, функции базы такого сочетания не оставляют. */}
      {enabled && !consent ? (
        <p className="flex items-start gap-2 t-body-compact text-warn" data-testid="v3-ai-memory-no-consent">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          Без согласия на Gemini память не работает: сводки не собираются.
        </p>
      ) : null}
      {settings.canManage && !preview ? (
        <AiMemoryToggle
          enabled={enabled}
          consentRecorded={consent}
          version={settings.version}
          requestId={requestId}
          action={saveAiMemoryAction}
          buttonClassName={btnGhostCls}
        />
      ) : null}
    </section>
  );
}
