"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { startTransition, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { Initials } from "@/components/v3/blocks/Initials";
import { StageChip, StatusChip } from "@/components/v3/blocks/StatusChip";
import type { PillTone } from "@/components/v3/Pill";
import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { useAnchoredPopover } from "@/components/v3/queue/useAnchoredPopover";
import { ReplySnippetPicker, type ReplySnippetPickerItem } from "@/components/v3/reply-snippets/ReplySnippetPicker";
import {
  loadStaffCaseChatThreadsAction, markCaseChatReadAction, postCaseChatMessageAction,
  readCaseChatPageAction, setCaseChatAwaitAction,
} from "@/lib/platform-case-chat-actions";
import type { AdmissionsPipelineStage } from "@/lib/platform-admissions-pipeline-contract";
import {
  CASE_CHAT_BODY_LIMIT, CASE_CHAT_DEFAULT_QUEUE, CASE_CHAT_FAILURE_COPY, CASE_CHAT_INITIAL_ACTION, CASE_CHAT_QUEUE_ORDER, appendOlderCaseChatPage, caseChatHref, parseCaseChatAttachParam, parseCaseChatQueue,
  type CaseChatActionState, type CaseChatAwaitState, type CaseChatFailure, type CaseChatMessage,
  type CaseChatPage, type CaseChatPendingAttachment, type CaseChatQueue, type CaseChatThreadRow, type CaseChatThreadsList,
} from "@/lib/platform-case-chat-contract";
import { stagePhase } from "@/lib/v3/stages";
import { admissionsPipelineStage, caseChatAwaitChoice, caseChatAwaitState } from "@/lib/v3/wording";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import type { SupabasePublicConfig } from "@/lib/supabase/config";
import { isStaleDeployment, noteStaleDeployment } from "@/lib/stale-deployment";
import { useStaleDeployment } from "@/lib/use-stale-deployment";

import { caseChatNextLine, type CaseChatQueueRead } from "./case-chat-queue";

const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });
/** Плотная дата строки списка: «25.09»; сегодняшнее сообщение — время «14:05». */
const ROW_DAY = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });

function rowTime(at: string, readAt: string): string {
  const moment = new Date(at);
  const now = new Date(readAt);
  if (Number.isFinite(now.getTime()) && DAY_KEY.format(moment) === DAY_KEY.format(now)) return TIME.format(moment);
  return ROW_DAY.format(moment);
}

/**
 * Э5 «Переписки»: «Нужен ответ» — предупреждение словом, не красный (красный
 * текст — только проблема); «Ждём студента» — нейтрально: ход за студентом.
 */
function awaitTone(state: CaseChatAwaitState): PillTone {
  return state === "needs_reply" ? "warn" : "neutral";
}

/** Состояние словом — чип (Э1.3). Слово есть всегда. */
function StateWord({ tone, label }: Readonly<{ tone: PillTone; label: string }>) {
  return <StatusChip label={label} tone={tone === "solid" ? "neutral" : tone} />;
}

/** Порядок видимого переключателя состояния в шапке переписки. */
const AWAIT_CONTROL_ORDER = ["needs_reply", "awaiting_student", "none"] as const satisfies readonly CaseChatAwaitState[];

/**
 * Шаблоны ответа для поля ответа (Э5): то же чтение и то же право, что у
 * WhatsApp (`readV3ReplySnippets`, `snippets.read`). null — права нет, кнопки
 * «Шаблон» нет; «unavailable» — чтение не удалось, окно говорит об этом.
 */
export type CaseChatSnippets =
  | Readonly<{ status: "ready"; items: readonly ReplySnippetPickerItem[] }>
  | Readonly<{ status: "unavailable" }>
  | null;

/** Факты дела для шапки переписки: направление и этап словами доски; null — строки очереди 241 нет. */
export type CaseChatCaseFacts = Readonly<{
  direction: string | null;
  stage: AdmissionsPipelineStage | null;
}>;

/**
 * Persisted part of the draft: text + pending attachment only. Which message
 * is being quoted is ephemeral, parent-owned state (`replyTo`) — not
 * restored across a reload, only the text and scroll position are (owner
 * plan: "Сохраняются черновик и положение переписки").
 */
type Draft = Readonly<{
  body: string; attachment: CaseChatPendingAttachment | null; requestId: string;
  retryBody?: string; retryQuotedMessageId?: string; retryAttachmentKind?: string; retryAttachmentId?: string;
}>;

function draftStorageKey(scope: string, caseId: string): string {
  return `evo-case-chat-draft-v1:${scope}:${caseId}`;
}
function scrollStorageKey(scope: string, caseId: string): string {
  return `evo-case-chat-scroll-v1:${scope}:${caseId}`;
}

function readStoredDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.body !== "string" || typeof parsed.requestId !== "string") return null;
    return {
      body: parsed.body, requestId: parsed.requestId,
      attachment: parsed.attachment && typeof parsed.attachment === "object"
        && "kind" in parsed.attachment && "id" in parsed.attachment
        ? (parsed.attachment as CaseChatPendingAttachment) : null,
      retryBody: typeof parsed.retryBody === "string" ? parsed.retryBody : undefined,
      retryQuotedMessageId: typeof parsed.retryQuotedMessageId === "string" ? parsed.retryQuotedMessageId : undefined,
      retryAttachmentKind: typeof parsed.retryAttachmentKind === "string" ? parsed.retryAttachmentKind : undefined,
      retryAttachmentId: typeof parsed.retryAttachmentId === "string" ? parsed.retryAttachmentId : undefined,
    };
  } catch { return null; }
}

const subscribeNever = () => () => {};
const clientTrue = () => true;
const serverFalse = () => false;

/**
 * Composer: plain textarea + «Отправить». Frozen-retry semantics copy
 * src/lib/platform-finance-entry-actions.ts + FinanceEntryForms /
 * TeamChatComposer.tsx: on "unavailable" the exact submitted field VALUES
 * (not just the request id) are frozen into retryBody/retryQuotedMessageId/
 * retryAttachmentKind/retryAttachmentId and reused verbatim on the next
 * submit, so a retry can never post a second, slightly-different message —
 * the server's fingerprint-checked receipt table only matches an identical
 * replay. The localStorage read happens in a lazy useState initializer
 * (never in an effect), same split as TeamChatComposer.tsx's own
 * mounted/lazy-init pattern, which also avoids a server/client markup
 * mismatch (localStorage does not exist during SSR).
 */
function CaseChatComposer(props: Readonly<{
  caseId: string; storageScope: string; pendingAttachment: CaseChatPendingAttachment | null;
  onAttachmentConsumed: () => void;
  replyTo: CaseChatMessage | null; onClearReply: () => void; onSaved: () => void;
  snippets: CaseChatSnippets;
}>) {
  const mounted = useSyncExternalStore(subscribeNever, clientTrue, serverFalse);
  return mounted
    ? <MountedCaseChatComposer {...props} />
    : <div className="border-t border-border p-3 text-sm text-fg-3" role="status">Загружаем черновик…</div>;
}

function MountedCaseChatComposer({
  caseId, storageScope, pendingAttachment, onAttachmentConsumed, replyTo, onClearReply, onSaved, snippets,
}: Readonly<{
  caseId: string; storageScope: string; pendingAttachment: CaseChatPendingAttachment | null;
  onAttachmentConsumed: () => void;
  replyTo: CaseChatMessage | null; onClearReply: () => void; onSaved: () => void;
  snippets: CaseChatSnippets;
}>) {
  const key = draftStorageKey(storageScope, caseId);
  const [initial] = useState<Draft>(() => {
    const stored = readStoredDraft(key);
    if (!stored) return { body: "", attachment: pendingAttachment, requestId: crypto.randomUUID() };
    // A fresh «Обсудить» link-card overrides whatever the stored draft held —
    // silently dropping it looked like the click did nothing.
    return pendingAttachment ? { ...stored, attachment: pendingAttachment } : stored;
  });
  const [draft, setDraft] = useState<Draft>(initial);
  const [storageError, setStorageError] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const consumedAttachment = useRef(false);

  // Notifies the parent that the one-shot ?attach= link-card has been folded
  // into the local draft above — an external-system notification, not local
  // state, so it belongs in an effect (never a raw setDraft call here).
  useEffect(() => {
    if (!pendingAttachment || consumedAttachment.current) return;
    consumedAttachment.current = true;
    try {
      // Persist the link-card before removing its only reloadable URL reference.
      localStorage.setItem(key, JSON.stringify(initial));
      onAttachmentConsumed();
    } catch { /* Keep ?attach until a later draft save or confirmed send succeeds. */ }
  }, [pendingAttachment, onAttachmentConsumed, key, initial]);

  function persist(next: Draft) {
    setDraft(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      if (pendingAttachment) { consumedAttachment.current = true; onAttachmentConsumed(); }
    } catch { setStorageError(true); }
  }

  const [state, setState] = useState<CaseChatActionState>(CASE_CHAT_INITIAL_ACTION);
  const [pending, setPending] = useState(false);
  // Прошлая сборка (A1): отправка не уйдёт до перезагрузки; попытка с тем же
  // request_id уже в localStorage и после неё повторяется без дубля.
  const stale = useStaleDeployment();
  const uncertain = state.status === "unavailable";
  const bodyLength = Array.from(draft.body).length;
  const tooLong = bodyLength > CASE_CHAT_BODY_LIMIT;
  const canSend = !pending && !stale && (draft.body.trim().length > 0 || draft.attachment !== null) && !tooLong;
  // Шаблон вставляется в текст и ничего не отправляет. Пока ответ отправляется
  // или повтор заморожен («Повторить»), текст менять нельзя — и шаблон тоже.
  const picker = useAnchoredPopover("start");
  const canPick = snippets !== null && !pending && !uncertain;

  useEffect(() => {
    const element = document.getElementById(picker.popoverId);
    if (!element) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") {
        element.querySelector<HTMLElement>("select, button, a[href]")?.focus();
        return;
      }
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || element.contains(active)) textarea.current?.focus();
      });
    };
    element.addEventListener("toggle", onToggle);
    return () => element.removeEventListener("toggle", onToggle);
  }, [picker.popoverId]);

  function openPicker() {
    const element = document.getElementById(picker.popoverId);
    if (element && !element.matches(":popover-open")) element.showPopover();
  }

  async function submit(form: FormData) {
    setPending(true);
    const attempted: Draft = {
      ...draft,
      retryBody: draft.body, retryQuotedMessageId: replyTo?.id ?? "",
      retryAttachmentKind: draft.attachment?.kind ?? "", retryAttachmentId: draft.attachment?.id ?? "",
    };
    persist(attempted);
    try {
      const result = await postCaseChatMessageAction(CASE_CHAT_INITIAL_ACTION, form);
      if (result.status === "saved") {
        const empty: Draft = { body: "", attachment: null, requestId: crypto.randomUUID() };
        persist(empty);
        try { localStorage.removeItem(key); } catch { setStorageError(true); }
        onAttachmentConsumed();
        onClearReply();
        onSaved();
        textarea.current?.focus();
      } else if (result.status !== "unavailable") {
        persist({ ...draft, requestId: crypto.randomUUID(), retryBody: undefined, retryQuotedMessageId: undefined, retryAttachmentKind: undefined, retryAttachmentId: undefined });
      }
      setState(result);
    } catch (cause) {
      noteStaleDeployment(cause);
      setState({ status: "unavailable", requestId: draft.requestId });
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="border-t border-border p-3" aria-label="Новое сообщение">
      <input type="hidden" name="case_id" value={caseId} />
      <input type="hidden" name="request_id" value={draft.requestId} />
      <input type="hidden" name="body" value={draft.retryBody ?? draft.body} />
      <input type="hidden" name="quoted_message_id" value={draft.retryQuotedMessageId ?? replyTo?.id ?? ""} />
      <input type="hidden" name="attachment_kind" value={draft.retryAttachmentKind ?? draft.attachment?.kind ?? ""} />
      <input type="hidden" name="attachment_id" value={draft.retryAttachmentId ?? draft.attachment?.id ?? ""} />

      {replyTo ? (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-ctl border border-border bg-surface-2 px-3 py-2 text-sm">
          <p className="min-w-0 truncate text-fg-2">{replyTo.authorName}: {replyTo.body}</p>
          <button type="button" className="shrink-0 text-fg-3 hover:text-fg" aria-label="Убрать цитату" onClick={onClearReply}>×</button>
        </div>
      ) : null}
      {draft.attachment ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-ctl border border-border bg-surface-2 px-3 py-2 text-sm">
          <span className="text-fg-2">{draft.attachment.kind === "document" ? "Документ дела" : "Задача дела"} прикреплён к сообщению</span>
          <button type="button" className="shrink-0 text-fg-3 hover:text-fg" aria-label="Убрать вложение" onClick={() => persist({ ...draft, attachment: null })}>×</button>
        </div>
      ) : null}

      <div className="flex items-end gap-1.5 @md:gap-2">
        {snippets !== null ? (
          <button
            type="button" id={picker.triggerId} popoverTarget={picker.popoverId} style={picker.triggerStyle}
            aria-haspopup="dialog" disabled={!canPick}
            className={`${QUEUE_SECONDARY} shrink-0 @max-md:px-0 @max-md:w-11`}
          >
            <Icon name="quote" size={18} className="shrink-0" />
            <span className="@max-md:sr-only">Шаблон</span>
          </button>
        ) : null}
        <label className="sr-only" htmlFor={`${key}-body`}>Сообщение в переписке</label>
        <textarea
          id={`${key}-body`} ref={textarea} value={draft.body} rows={1} maxLength={CASE_CHAT_BODY_LIMIT + 200}
          readOnly={pending || uncertain} disabled={pending}
          placeholder="Сообщение…" aria-invalid={tooLong || undefined}
          className="min-h-11 min-w-0 flex-1 resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm text-fg"
          onChange={(event) => persist({ ...draft, body: event.target.value })}
          onKeyDown={(event) => {
            // «/» в пустом поле открывает шаблоны, как кнопка «Шаблон»; сам знак не печатается.
            if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
            if (!canPick || draft.body !== "") return;
            event.preventDefault();
            openPicker();
          }}
        />
        <button type="submit" disabled={!canSend} className="inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-3 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-55 @md:px-4">
          {pending ? "Отправляем…" : uncertain ? "Повторить" : "Отправить"}
        </button>
      </div>
      {tooLong ? <p role="alert" className="mt-1 text-sm text-danger">Сократите сообщение до {CASE_CHAT_BODY_LIMIT} символов.</p> : null}
      {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className="mt-1 text-sm text-danger">{CASE_CHAT_FAILURE_COPY[state.status]}</p> : null}
      {storageError ? <p className="mt-1 text-sm text-fg-3">Браузер не сохраняет черновик в этой вкладке.</p> : null}
      {snippets !== null ? (
        <div
          id={picker.popoverId} popover="auto" role="dialog" aria-label="Шаблон ответа" style={picker.popoverStyle}
          data-testid="case-chat-snippet-popover"
          className="v3-anchored w-[min(24rem,calc(100vw-1rem))] rounded-ctl border border-border bg-surface p-3 text-fg shadow-evo-lg"
        >
          {snippets.status === "ready" ? (
            <ReplySnippetPicker
              snippets={snippets.items}
              messageText={draft.body}
              textareaRef={textarea}
              maxCodePoints={CASE_CHAT_BODY_LIMIT}
              disabled={!canPick}
              onMessageTextChange={(value) => {
                persist({ ...draft, body: value });
                document.getElementById(picker.popoverId)?.hidePopover();
              }}
            />
          ) : (
            <p role="alert" className="t-body-compact text-danger">Шаблоны не загрузились. Обновите страницу.</p>
          )}
        </div>
      ) : null}
    </form>
  );
}

/**
 * Нажатая часть переключателя состояния — в тоне самого состояния, а не общим
 * «выбрано» (`.v3-choice`): так запись состояния не читается как фильтр
 * очереди рядом и никогда не красная. «Нужен ответ» — предупреждение
 * (янтарь со словом), остальные — нейтрально: поднятая часть на подложке.
 */
const AWAIT_PRESSED: Readonly<Record<CaseChatAwaitState, string>> = {
  needs_reply: "aria-pressed:border-warn/40 aria-pressed:bg-warn-weak aria-pressed:text-warn",
  awaiting_student: "aria-pressed:border-border-strong aria-pressed:bg-surface aria-pressed:text-fg",
  none: "aria-pressed:border-border-strong aria-pressed:bg-surface aria-pressed:text-fg",
};

/**
 * Шапка переписки (Э5): с кем переписка — имя, направление и этап словами
 * доски поступления, «Открыть дело»; состояние — видимым переключателем из
 * трёх (прежняя команда `set_await`) с подписью «Состояние», а не пунктом
 * меню «⋯». После ответа сотрудника «Ждём студента» ставит сама команда
 * отправки (245); переключатель — для ручных изменений. `awaitState` null —
 * состояние не прочитано, переключателя нет. На узком экране «К списку» —
 * стрелка в строке имени (заголовок страницы и каналы тогда скрыты), чтобы
 * лента начиналась как можно выше.
 */
function ThreadHeader({
  name, facts, caseId, listHref, awaitState, onSetAwait, awaitPending,
}: Readonly<{
  name: string | null; facts: CaseChatCaseFacts | null; caseId: string; listHref: string;
  awaitState: CaseChatAwaitState | null;
  onSetAwait: (state: CaseChatAwaitState) => void; awaitPending: boolean;
}>) {
  const stage = facts?.stage ? admissionsPipelineStage(facts.stage) : null;
  const direction = facts?.direction ?? null;
  return (
    <div className="flex flex-col gap-2 border-b border-border p-3" data-testid="case-chat-thread-header">
      <div className="flex items-start justify-between gap-2 @2xl:gap-3">
        <div className="flex min-w-0 items-start gap-1 @2xl:gap-2.5">
          <Link href={listHref} scroll={false} aria-label="К списку" title="К списку"
            className="-my-1 -ms-2 inline-flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg @2xl:hidden">
            <Icon name="arrow-left" size={20} className="shrink-0" />
          </Link>
          {name ? <span className="mt-0.5 hidden shrink-0 @2xl:block"><Initials name={name} decorative /></span> : null}
          <div className="min-w-0">
            {/* Узко имя встаёт в две строки, а не в «Студент …»: с кем переписка — главное. */}
            <h2 className="t-section break-words text-fg @max-2xl:line-clamp-2 @2xl:truncate">{name ?? "Переписка"}</h2>
            {direction || stage ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 t-body-compact text-fg-2" data-testid="case-chat-case-facts">
                {direction ? <span>{direction}</span> : null}
                {direction && stage ? <span aria-hidden="true" className="text-fg-3">·</span> : null}
                {stage ? <StageChip label={stage} phase={stagePhase("admissions", facts?.stage)} /> : null}
              </p>
            ) : null}
          </div>
        </div>
        <Link href={`/v3/profile?case=${caseId}`} className={`${QUEUE_SECONDARY} shrink-0 hover:bg-surface-2 hover:text-fg`}>
          Открыть дело
        </Link>
      </div>
      {awaitState !== null ? (
        /* Подпись «Состояние» отличает запись от фильтра очереди. Узко —
           подпись над переключателем и три равные части на всю ширину (слово
           может встать в две строки), широко — в строку, по ширине слов. */
        <div className="flex flex-col gap-1 @2xl:flex-row @2xl:items-center @2xl:gap-3">
          <span className="t-label text-fg-3" aria-hidden="true">Состояние</span>
          <div role="group" aria-label="Состояние переписки" data-testid="case-chat-await-control"
            className="grid grid-cols-3 gap-0.5 rounded-ctl border border-border bg-surface-2 p-0.5 @2xl:flex @2xl:w-fit">
            {AWAIT_CONTROL_ORDER.map((value) => (
              <button key={value} type="button" aria-pressed={awaitState === value} disabled={awaitPending}
                onClick={() => { if (value !== awaitState) onSetAwait(value); }}
                data-tone={awaitTone(value)}
                className={`inline-flex min-h-11 items-center justify-center rounded-nav border border-transparent px-1.5 text-center t-label text-fg-2 hover:text-fg aria-pressed:font-semibold ${AWAIT_PRESSED[value]} disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring @2xl:whitespace-nowrap @2xl:px-3`}>
                {caseChatAwaitChoice(value)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentCard({ message, caseId }: Readonly<{ message: CaseChatMessage; caseId: string }>) {
  if (!message.attachmentKind || !message.attachmentId) return null;
  const href = message.attachmentKind === "document"
    ? `/v3/profile?case=${caseId}&tab=documents`
    : `/v3/tasks?task=${message.attachmentId}&kind=case&case=${caseId}`;
  return (
    <Link href={href} className="mt-1.5 flex min-h-11 items-center gap-2 rounded-ctl border border-border bg-surface px-3 py-2 text-sm text-fg underline decoration-transparent hover:decoration-inherit">
      <Icon name={message.attachmentKind === "document" ? "folder" : "check-square"} size={16} />
      <span className="truncate">{message.attachmentLabel ?? (message.attachmentKind === "document" ? "Документ дела" : "Задача дела")}</span>
    </Link>
  );
}

/**
 * Сообщение ленты. «Действия с сообщением» — знак из набора иконок в строке
 * «автор · время» самого пузыря (не отдельной строкой под ним и не символом
 * «⋯»): цель 44 px, но строка пузыря от неё не растёт. Меню — в верхнем слое
 * (popover), прокрутка ленты его не обрежет.
 */
function MessageRow({
  message, own, caseId, onReply,
}: Readonly<{ message: CaseChatMessage; own: boolean; caseId: string; onReply: (message: CaseChatMessage) => void }>) {
  const menu = useAnchoredPopover(own ? "end" : "start");
  return (
    <div className={`flex flex-col py-2 ${own ? "items-end" : "items-start"}`} id={`case-message-${message.id}`}>
      <div className={`max-w-[85%] min-w-0 rounded-ctl px-3 py-2 ${own ? "bg-accent/10" : "bg-surface-2"}`}>
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-xs text-fg-3">
            <span className="font-medium text-fg-2">{own ? "Вы" : message.authorName}</span>
            <time dateTime={message.createdAt}>{TIME.format(new Date(message.createdAt))}</time>
          </p>
          <button type="button" id={menu.triggerId} popoverTarget={menu.popoverId} style={menu.triggerStyle}
            aria-label="Действия с сообщением"
            className="group -my-3.5 -me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-3 hover:text-fg">
            {/* Цель — 44 px, подложка при наведении — только вокруг знака, внутри пузыря. */}
            <span className="inline-flex size-7 items-center justify-center rounded-nav group-hover:bg-surface-3">
              <Icon name="more-horizontal" size={16} className="shrink-0" />
            </span>
          </button>
        </div>
        {message.quotedPreview ? (
          <p className="mt-1 truncate border-s-2 border-border ps-2 text-xs text-fg-3">
            {message.quotedPreview.authorName}: {message.quotedPreview.bodyPreview}
          </p>
        ) : null}
        {message.body ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{message.body}</p> : null}
        <AttachmentCard message={message} caseId={caseId} />
      </div>
      <div id={menu.popoverId} popover="auto" role="group" aria-label="Действия с сообщением" style={menu.popoverStyle}
        className={`v3-anchored ${own ? "v3-anchored-end" : ""} w-52 rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg`}>
        <button type="button" className="flex min-h-11 w-full items-center rounded-nav px-2 text-left text-sm text-fg hover:bg-surface-2"
          onClick={() => { document.getElementById(menu.popoverId)?.hidePopover(); onReply(message); }}>
          Ответить с цитатой
        </button>
      </div>
    </div>
  );
}

function CaseChatThreadView({
  caseId, initialPage, initialFailure, storageScope, membershipId, pendingAttachment, onAttachmentConsumed,
  organizationId, realtimeConfig, studentDisplayName, listHref, onListChanged, facts, snippets,
}: Readonly<{
  caseId: string; initialPage: CaseChatPage | null; initialFailure: CaseChatFailure | null;
  storageScope: string; membershipId: string; pendingAttachment: CaseChatPendingAttachment | null;
  onAttachmentConsumed: () => void; organizationId: string; realtimeConfig: SupabasePublicConfig;
  studentDisplayName: string | null; listHref: string; onListChanged: () => void;
  facts: CaseChatCaseFacts | null; snippets: CaseChatSnippets;
}>) {
  const [page, setPage] = useState<CaseChatPage | null>(initialPage);
  const [error, setError] = useState<CaseChatFailure | null>(initialFailure);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<CaseChatMessage | null>(null);
  const [awaitPending, setAwaitPending] = useState(false);
  const [awaitState, setAwaitState] = useState<CaseChatAwaitState | null>(initialPage?.thread.awaitState ?? null);
  const viewport = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const pageSequence = useRef(0);
  const markedUpTo = useRef<string>(initialPage?.readSequenceId ?? "0");
  // Вкладка пережила выпуск (A1): живые обновления сняты, перечитывание
  // молчит, а обновить страницу просит оболочка (StaleDeploymentNotice).
  const stale = useStaleDeployment();

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (isStaleDeployment()) return;
    const sequence = ++pageSequence.current;
    onListChanged();
    try {
      const result = await readCaseChatPageAction(caseId, "latest");
      if (!alive.current || sequence !== pageSequence.current) return;
      if (result.status !== "ready") { setError(result.status); return; }
      setError(null);
      setPage(result.page);
      setAwaitState(result.page.thread.awaitState);
    } catch (cause) {
      if (noteStaleDeployment(cause)) return;
      if (alive.current && sequence === pageSequence.current) setError("unavailable");
    }
  }, [caseId, onListChanged]);

  // App Router can restore a cached RSC page on browser Back/Forward. Re-read
  // server state without remounting the composer or discarding its local draft.
  useEffect(() => {
    const restore = () => { void refresh(); };
    const timer = setTimeout(restore, 0);
    window.addEventListener("popstate", restore);
    return () => { clearTimeout(timer); window.removeEventListener("popstate", restore); };
  }, [refresh]);

  useEffect(() => {
    if (stale) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let client: SupabaseClient | undefined;
    let subscription: RealtimeChannel | undefined;
    const requestRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!cancelled) startTransition(() => { void refresh(); }); }, 150);
    };
    async function connect() {
      try {
        client = createBrowserClient(realtimeConfig.url, realtimeConfig.publishableKey);
        const { data, error: authError } = await client.auth.getSession();
        if (cancelled || authError || !data.session) return;
        await client.realtime.setAuth(data.session.access_token);
        if (cancelled) return;
        subscription = client.channel(`case-chat:${organizationId}:${caseId}`, { config: { private: true } })
          .on("broadcast", { event: "invalidate" }, requestRefresh)
          .subscribe();
      } catch { /* the composer/manual refresh remain available without realtime */ }
    }
    void connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (subscription && client) void client.removeChannel(subscription);
    };
  }, [caseId, organizationId, realtimeConfig.url, realtimeConfig.publishableKey, refresh, stale]);

  // Scroll: pinned to bottom on load; position preserved across refresh via
  // a saved scrollTop, restored once per case mount.
  useEffect(() => {
    const key = scrollStorageKey(storageScope, caseId);
    let restored = false;
    try {
      const saved = localStorage.getItem(key);
      if (saved) { const value = Number(saved); if (Number.isFinite(value) && viewport.current) { viewport.current.scrollTop = value; restored = true; } }
    } catch { /* ignore */ }
    if (!restored && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    const node = viewport.current;
    const onScroll = () => { try { if (node) localStorage.setItem(key, String(node.scrollTop)); } catch { /* ignore */ } };
    node?.addEventListener("scroll", onScroll);
    return () => node?.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Mark-read: fires while the thread is open and new messages render.
  // Reading alone never clears «Нужен ответ» — the RPC only bumps the
  // caller's own cursor.
  useEffect(() => {
    if (!page || !page.messages.length || isStaleDeployment()) return;
    const latest = page.messages[0]?.sequenceId ?? "0";
    if (BigInt(latest) <= BigInt(markedUpTo.current)) return;
    markedUpTo.current = latest;
    const form = new FormData();
    form.set("request_id", crypto.randomUUID()); form.set("case_id", caseId); form.set("sequence_id", latest);
    void markCaseChatReadAction(CASE_CHAT_INITIAL_ACTION, form).then((result) => {
      if (alive.current && result.status === "saved") onListChanged();
    }).catch((cause: unknown) => { noteStaleDeployment(cause); /* A failed read acknowledgement must not clear work state. */ });
  }, [page, caseId, onListChanged]);

  async function loadOlder() {
    if (!page || !page.hasMore || busy || isStaleDeployment()) return;
    setBusy(true);
    const node = viewport.current;
    const position = node?.scrollTop ?? 0;
    const height = node?.scrollHeight ?? 0;
    try {
      const result = await readCaseChatPageAction(caseId, "before", page.cursor);
      if (result.status !== "ready") { setError(result.status); return; }
      setPage((previous) => previous ? appendOlderCaseChatPage(previous, result.page) : result.page);
      requestAnimationFrame(() => { if (node) node.scrollTop = position + node.scrollHeight - height; });
    } catch (cause) {
      if (!noteStaleDeployment(cause)) throw cause;
    } finally { setBusy(false); }
  }

  async function changeAwait(state: CaseChatAwaitState) {
    ++pageSequence.current;
    setAwaitPending(true);
    try {
      const form = new FormData();
      form.set("request_id", crypto.randomUUID()); form.set("case_id", caseId); form.set("state", state);
      const result = await setCaseChatAwaitAction(CASE_CHAT_INITIAL_ACTION, form);
      if (!alive.current) return;
      if (result.status === "saved") {
        ++pageSequence.current;
        setAwaitState(state);
        setError(null);
        onListChanged();
      }
      else if (result.status !== "idle") setError(result.status);
    } catch (cause) { if (!noteStaleDeployment(cause) && alive.current) setError("unavailable"); }
    finally { if (alive.current) setAwaitPending(false); }
  }

  if (!page) {
    return <div className="flex min-w-0 flex-1 flex-col">
      <ThreadHeader name={studentDisplayName} facts={facts} caseId={caseId} listHref={listHref}
        awaitState={null} onSetAwait={() => {}} awaitPending={false} />
      <p role="alert" className="p-4 text-sm text-danger">{CASE_CHAT_FAILURE_COPY[error ?? "unavailable"]}</p>
    </div>;
  }

  const messages = [...page.messages].reverse();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ThreadHeader
        name={studentDisplayName} facts={facts} caseId={caseId} listHref={listHref}
        awaitState={awaitState ?? page.thread.awaitState} onSetAwait={changeAwait} awaitPending={awaitPending} />
      {error ? <p role="alert" className="px-3 pt-2 text-sm text-danger">{CASE_CHAT_FAILURE_COPY[error]}</p> : null}
      <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto px-3" aria-label="История переписки">
        {page.hasMore ? <button type="button" disabled={busy || stale} onClick={() => void loadOlder()} className="my-2 inline-flex min-h-11 items-center rounded-ctl border border-border px-3 text-sm text-fg-2 hover:bg-surface-2">
          Показать более ранние
        </button> : null}
        {messages.length ? messages.map((message) => (
          <MessageRow key={message.id} message={message} own={message.authorMembershipId === membershipId} caseId={caseId}
            onReply={(target) => setReplyTo(target)} />
        )) : <p className="py-10 text-center text-sm text-fg-3">Сообщений пока нет. Куратор может начать разговор.</p>}
      </div>
      <CaseChatComposer caseId={caseId} storageScope={storageScope} pendingAttachment={pendingAttachment}
        onAttachmentConsumed={onAttachmentConsumed} replyTo={replyTo} onClearReply={() => setReplyTo(null)}
        onSaved={() => startTransition(() => { void refresh(); })} snippets={snippets} />
    </div>
  );
}

/**
 * Отметки строки словами. Состояние — только в «Всех»: в очереди оно у всех
 * строк одно и ничего не сообщает. «Непрочитанное» — отдельное состояние
 * (чтение 234): чужое сообщение после моей отметки прочтения.
 */
function threadRowBadges(row: CaseChatThreadRow, queue: CaseChatQueue): { tone: PillTone; text: string }[] {
  const badges: { tone: PillTone; text: string }[] = [];
  if (queue === "all" && row.awaitState !== "none") {
    const text = caseChatAwaitState(row.awaitState);
    if (text) badges.push({ tone: awaitTone(row.awaitState), text });
  }
  if (row.unread) badges.push({ tone: "info", text: "Непрочитанное" });
  return badges;
}

function queueLabel(queue: CaseChatQueue): string {
  return queue === "all" ? "Все" : caseChatAwaitState(queue) ?? "";
}

function CaseChatList({
  threads, counts, readAt, selectedCaseId, query, onQuery, queue, onQueue, membershipId, hidden, loading, failure, onRetry,
}: Readonly<{
  threads: CaseChatThreadsList; counts: CaseChatQueueRead["counts"] | null; readAt: string;
  selectedCaseId: string | null; query: string; onQuery: (value: string) => void;
  queue: CaseChatQueue; onQueue: (value: CaseChatQueue) => void;
  membershipId: string; hidden: boolean; loading: boolean; failure: CaseChatFailure | null; onRetry: () => void;
}>) {
  const router = useRouter();
  return (
    <nav aria-label="Переписки кабинета студента" className={`${hidden ? "hidden @2xl:flex" : "flex"} w-full flex-col border-border @2xl:w-[360px] @2xl:shrink-0 @2xl:border-e`}>
      <div className="flex flex-col gap-2 border-b border-border p-3">
        {/* Очереди на виду (Э5): число — из того же чтения, только из полного; «Все» без числа. */}
        <div role="group" aria-label="Очередь переписок" data-testid="case-chat-queues" className="flex flex-wrap gap-1">
          {CASE_CHAT_QUEUE_ORDER.map((value) => {
            const count = value === "all" || counts === null ? null : counts[value];
            return (
              <button key={value} type="button" aria-pressed={queue === value} onClick={() => onQueue(value)}
                className="v3-choice inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-nav px-2.5 t-label text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
                {queueLabel(value)}
                {count !== null ? <span className="tabular-nums text-fg-3" data-queue-count={value}>{count}</span> : null}
              </button>
            );
          })}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); }} role="search">
          <label className="sr-only" htmlFor="case-chat-search">Поиск по студенту</label>
          <input id="case-chat-search" type="search" value={query} placeholder="Поиск по студенту"
            onChange={(event) => onQuery(event.target.value)}
            className="min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 text-sm text-fg" />
        </form>
      </div>
      {loading ? <p role="status" className="p-4 text-sm text-fg-3">Ищем переписки…</p> : null}
      {failure ? <div className="p-4">
        <p role="alert" className="text-sm text-danger">{failure === "forbidden"
          ? "Доступ к перепискам изменился. Обновите страницу."
          : "Не удалось загрузить переписки. Повторите поиск."}</p>
        <button type="button" onClick={onRetry} className="mt-2 inline-flex min-h-11 items-center rounded-ctl border border-border px-3 text-sm text-fg hover:bg-surface-2">
          Повторить поиск
        </button>
      </div> : null}
      <div className="flex-1 overflow-y-auto" aria-busy={loading}>
        {!loading && !failure && (threads.rows.length === 0 ? <div className="p-4">
          <p role="status" className="text-sm text-fg-3">{query.trim()
            ? queue === "all" ? "По вашему запросу переписок не найдено." : "В этой очереди нет переписок по вашему запросу."
            : queue === "needs_reply" ? "Нет переписок, ждущих ответа." : queue === "all" ? "Переписок пока нет." : "В этой очереди переписок нет."}</p>
          {query.trim() ? <button type="button" onClick={() => onQuery("")} className="mt-2 inline-flex min-h-11 items-center rounded-ctl border border-border px-3 text-sm text-fg hover:bg-surface-2">
            Сбросить поиск
          </button> : queue !== "all" ? <button type="button" onClick={() => onQueue("all")} className="mt-2 inline-flex min-h-11 items-center rounded-ctl border border-border px-3 text-sm text-fg hover:bg-surface-2">
            Показать все переписки
          </button> : null}
        </div> : threads.rows.map((row) => {
          const badges = threadRowBadges(row, queue);
          return (
            <button key={row.studentCaseId} type="button"
              onClick={() => router.push(caseChatHref(query, queue, row.studentCaseId))}
              aria-current={row.studentCaseId === selectedCaseId ? "page" : undefined}
              data-case-chat-row={row.studentCaseId}
              className={`flex w-full items-start gap-2.5 border-b border-border px-3 py-3 text-start hover:bg-surface-2 ${row.studentCaseId === selectedCaseId ? "bg-surface-2" : ""}`}>
              <span className="mt-0.5 shrink-0"><Initials name={row.studentDisplayName} decorative /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate t-item text-fg">{row.studentDisplayName}</span>
                  {row.lastMessageAt ? <time className="t-meta shrink-0 font-mono tabular-nums text-fg-3" dateTime={row.lastMessageAt}>{rowTime(row.lastMessageAt, readAt)}</time> : null}
                </span>
                {row.lastMessageSnippet ? <span className="truncate text-sm text-fg-2">
                  {row.lastMessageAuthorMembershipId === membershipId ? "Вы: " : ""}{row.lastMessageSnippet}
                </span> : <span className="text-sm text-fg-3">Нет сообщений</span>}
                {badges.length ? <span className="mt-0.5 flex flex-wrap gap-1">{badges.map((badge) => <StateWord key={badge.text} tone={badge.tone} label={badge.text} />)}</span> : null}
              </span>
            </button>
          );
        }))}
        {!loading && !failure && threads.truncated ? <p className="t-meta p-3 text-fg-3">Показаны первые {threads.rows.length}. Уточните поиск.</p> : null}
      </div>
    </nav>
  );
}

/**
 * Правая часть без открытой переписки (Э5): вместо «Выберите переписку
 * слева.» — следующая переписка, ждущая ответа, дольше всех ждущая (из
 * полного чтения), или тихое «Все ответы даны» — в любой очереди, в том
 * числе в пустой «Нужен ответ» (список слева тогда говорит «Нет переписок,
 * ждущих ответа.», без повтора). Иначе — пусто.
 */
function NextThreadPane({ read, membershipId, query, queue, loading, failure }: Readonly<{
  read: CaseChatQueueRead; membershipId: string; query: string; queue: CaseChatQueue;
  loading: boolean; failure: CaseChatFailure | null;
}>) {
  const line = loading || failure ? { kind: "none" as const } : caseChatNextLine(read, membershipId, query);
  return (
    <div className="hidden flex-1 flex-col items-center justify-center gap-3 p-6 text-center @2xl:flex" data-testid="case-chat-next">
      {line.kind === "next" ? (
        <>
          <p className="max-w-[48ch] t-body text-fg-2">
            Следующий: <span className="font-semibold text-fg">{line.row.studentDisplayName}</span>
            {line.waiting ? <> — {line.waiting}</> : null}
          </p>
          <Link href={caseChatHref(query, queue, line.row.studentCaseId)} scroll={false} className={`${QUEUE_SECONDARY} hover:bg-surface-2 hover:text-fg`}
            aria-label={`Открыть переписку: ${line.row.studentDisplayName}`}>
            Открыть
          </Link>
        </>
      ) : line.kind === "all-answered" ? (
        <p className="t-body text-fg-3">Все ответы даны</p>
      ) : null}
    </div>
  );
}

export function CaseChatWorkspace({
  organizationId, membershipId, realtimeConfig, initialQueue, initialStudentDisplayName, selectedCaseId, initialPage,
  initialPageFailure, caseFacts = null, snippets = null,
}: Readonly<{
  organizationId: string; membershipId: string; realtimeConfig: SupabasePublicConfig;
  initialQueue: CaseChatQueueRead; selectedCaseId: string | null;
  initialStudentDisplayName: string | null;
  initialPage: CaseChatPage | null; initialPageFailure: CaseChatFailure | null;
  /** Направление и этап открытого дела (строка очереди 241); null — нет строки. */
  caseFacts?: CaseChatCaseFacts | null;
  snippets?: CaseChatSnippets;
}>) {
  const [queueRead, setQueueRead] = useState(initialQueue);
  const threads = queueRead.list;
  // The actual history entry owns filters; cached initial server props do not.
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  // Поиск, по которому прочитаны числа (сначала — поиск чтения страницы):
  // другой поиск — чисел нет, пока не придёт его чтение.
  const [countsQuery, setCountsQuery] = useState(() => query.trim());
  const queue = parseCaseChatQueue(params.get("queue") ?? undefined) ?? CASE_CHAT_DEFAULT_QUEUE;
  const attachment = params.get("case") === selectedCaseId ? parseCaseChatAttachParam(params.get("attach")) : null;
  const scope = useRef({ query, queue });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<CaseChatFailure | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchSequence = useRef(0);

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    searchSequence.current += 1;
  }, []);

  const search = useCallback(async (value: string, selectedQueue: CaseChatQueue, sequence: number) => {
    try {
      // Прошлая сборка (A1): список не перечитывается до перезагрузки.
      if (isStaleDeployment()) return;
      const result = await loadStaffCaseChatThreadsAction(value, selectedQueue);
      if (sequence !== searchSequence.current) return;
      if (result.status === "ready") { setQueueRead(result.read); setCountsQuery(value.trim()); }
      else setFailure(result.status);
    } catch (cause) {
      if (noteStaleDeployment(cause) || sequence !== searchSequence.current) return;
      setFailure("unavailable");
    } finally {
      if (sequence === searchSequence.current) setLoading(false);
    }
  }, []);

  const refreshList = useCallback(() => {
    clearTimeout(debounceRef.current);
    const sequence = ++searchSequence.current;
    setFailure(null);
    setLoading(true);
    void search(scope.current.query, scope.current.queue, sequence);
  }, [search]);

  const invalidateSearch = useCallback(() => {
    clearTimeout(debounceRef.current);
    searchSequence.current += 1;
    setFailure(null);
    setLoading(true);
  }, []);

  useEffect(() => {
    const delay = scope.current.query === query ? 0 : 250;
    scope.current = { query, queue };
    clearTimeout(debounceRef.current);
    const sequence = ++searchSequence.current;
    debounceRef.current = setTimeout(() => {
      setFailure(null);
      setLoading(true);
      void search(query, queue, sequence);
    }, delay);
    return () => clearTimeout(debounceRef.current);
  }, [query, queue, search]);

  useEffect(() => {
    // Also handles history entries with unchanged q/queue. Invalidate before
    // a response can settle while Next restores the selected route.
    const restore = () => {
      const current = new URL(window.location.href);
      scope.current = {
        query: current.searchParams.get("q") ?? "",
        queue: parseCaseChatQueue(current.searchParams.get("queue") ?? undefined) ?? CASE_CHAT_DEFAULT_QUEUE,
      };
      refreshList();
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [refreshList]);

  function onQuery(value: string) {
    invalidateSearch();
    window.history.replaceState(null, "", caseChatHref(value, queue, selectedCaseId, attachment));
  }

  function onQueue(value: CaseChatQueue) {
    if (value === queue) return;
    invalidateSearch();
    window.history.replaceState(null, "", caseChatHref(query, value, selectedCaseId, attachment));
  }

  function consumeAttachment() {
    const url = new URL(window.location.href);
    if (url.searchParams.get("case") !== selectedCaseId || !url.searchParams.has("attach")) return;
    url.searchParams.delete("attach");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  const row = threads.rows.find((item) => item.studentCaseId === selectedCaseId);
  const counts = countsQuery === query.trim() ? queueRead.counts : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 rounded-card border border-border bg-surface">
      <CaseChatList threads={threads} counts={counts} readAt={queueRead.readAt} selectedCaseId={selectedCaseId} query={query} onQuery={onQuery}
        queue={queue} onQueue={onQueue}
        membershipId={membershipId} hidden={selectedCaseId !== null} loading={loading} failure={failure} onRetry={refreshList} />
      {selectedCaseId ? (
        <CaseChatThreadView caseId={selectedCaseId} initialPage={initialPage} initialFailure={initialPageFailure}
          storageScope={`${organizationId}:${membershipId}`} membershipId={membershipId} pendingAttachment={attachment}
          onAttachmentConsumed={consumeAttachment} organizationId={organizationId} realtimeConfig={realtimeConfig}
          studentDisplayName={row?.studentDisplayName ?? initialStudentDisplayName} onListChanged={refreshList}
          listHref={caseChatHref(query, queue)} facts={caseFacts} snippets={snippets} />
      ) : (
        <NextThreadPane read={queueRead} membershipId={membershipId} query={query} queue={queue} loading={loading} failure={failure} />
      )}
    </div>
  );
}
