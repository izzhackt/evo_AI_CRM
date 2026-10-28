"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
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
import { admissionsPipelineStage, caseChatAwaitChoice, caseChatAwaitState, caseDocumentsWords } from "@/lib/v3/wording";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import type { SupabasePublicConfig } from "@/lib/supabase/config";
import { isStaleDeployment, noteStaleDeployment } from "@/lib/stale-deployment";
import { useStaleDeployment } from "@/lib/use-stale-deployment";

import { caseChatNextLine, type CaseChatQueueRead } from "./case-chat-queue";

const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });
/** Плотная дата строки списка: «25.09»; сегодняшнее сообщение — время «14:05». */
const ROW_DAY = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });

const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: PLATFORM_ORGANIZATION_TIMEZONE });

/** День ленты по времени организации; пустая строка — дату не прочитать. */
function dayKey(at: string): string {
  const moment = new Date(at);
  return Number.isFinite(moment.getTime()) ? DAY_KEY.format(moment) : "";
}

/** Разделитель дня, как у чата WhatsApp: «Сегодня», «Вчера», «5 октября»; год — если не текущий. */
function dayLabel(at: string, readAt: string): string {
  const moment = new Date(at);
  const now = new Date(readAt);
  if (!Number.isFinite(moment.getTime())) return "";
  if (Number.isFinite(now.getTime())) {
    const today = DAY_KEY.format(now);
    const day = DAY_KEY.format(moment);
    if (day === today) return "Сегодня";
    if (day === DAY_KEY.format(new Date(now.getTime() - 86_400_000))) return "Вчера";
    if (day.slice(0, 4) === today.slice(0, 4)) return DAY_MONTH.format(moment);
  }
  return DAY_MONTH_YEAR.format(moment).replace(/\s*г\.$/u, "");
}

export function rowTime(at: string, readAt: string): string {
  const moment = new Date(at);
  const now = new Date(readAt);
  if (Number.isFinite(now.getTime()) && DAY_KEY.format(moment) === DAY_KEY.format(now)) return TIME.format(moment);
  return ROW_DAY.format(moment);
}

/**
 * Э5 «Переписки»: «Нужен ответ» — предупреждение словом, не красный (красный
 * текст — только проблема); «Ждём студента» — нейтрально: ход за студентом.
 */
export function awaitTone(state: CaseChatAwaitState): PillTone {
  return state === "needs_reply" ? "warn" : "neutral";
}

/** Состояние словом — чип (Э1.3). Слово есть всегда. */
function StateWord({ tone, label }: Readonly<{ tone: PillTone; label: string }>) {
  return <StatusChip label={label} tone={tone} />;
}

/** Порядок видимого переключателя состояния в шапке переписки. */
export const AWAIT_CONTROL_ORDER = ["needs_reply", "awaiting_student", "none"] as const satisfies readonly CaseChatAwaitState[];

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
  // До монтирования — рамка поля без подписи: черновик читается из localStorage только в браузере.
  return mounted
    ? <MountedCaseChatComposer {...props} />
    : <div className="shrink-0 border-t border-border bg-surface px-3 pb-3 pt-2.5" aria-busy="true"><div className="h-[54px] rounded-card border border-border" /></div>;
}

/** Восемь строк поля: дальше оно прокручивается само. */
const COMPOSER_MAX_LINES = 8;

/** Кнопка «×» в строке цитаты и вложения: цель 44 px, подложка при наведении. */
const CHIP_CLOSE = "inline-flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-3 hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

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
  const composing = useRef(false);
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

  // Поле растёт с текстом до восьми строк (после вставки шаблона — тоже).
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    const style = getComputedStyle(field);
    const line = parseFloat(style.lineHeight) || 24;
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    field.style.height = "auto";
    const next = Math.min(field.scrollHeight, line * COMPOSER_MAX_LINES + chrome);
    field.style.height = `${next}px`;
    field.style.overflowY = field.scrollHeight > next ? "auto" : "hidden";
  }, [draft.body]);

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
    <form action={submit} className="shrink-0 border-t border-border bg-surface px-3 pb-3 pt-2.5" aria-label="Новое сообщение">
      <input type="hidden" name="case_id" value={caseId} />
      <input type="hidden" name="request_id" value={draft.requestId} />
      <input type="hidden" name="body" value={draft.retryBody ?? draft.body} />
      <input type="hidden" name="quoted_message_id" value={draft.retryQuotedMessageId ?? replyTo?.id ?? ""} />
      <input type="hidden" name="attachment_kind" value={draft.retryAttachmentKind ?? draft.attachment?.kind ?? ""} />
      <input type="hidden" name="attachment_id" value={draft.retryAttachmentId ?? draft.attachment?.id ?? ""} />

      {replyTo ? (
        <div className="mb-2 flex min-h-11 items-center justify-between gap-2 rounded-ctl border border-border bg-bg ps-3">
          <p className="min-w-0 truncate t-body-compact text-fg-2">{replyTo.authorName}: {replyTo.body}</p>
          <button type="button" className={CHIP_CLOSE} aria-label="Убрать цитату" onClick={onClearReply}>
            <Icon name="x" size={16} className="shrink-0" />
          </button>
        </div>
      ) : null}
      {draft.attachment ? (
        <div className="mb-2 flex min-h-11 items-center justify-between gap-2 rounded-ctl border border-border bg-bg ps-3">
          <span className="min-w-0 truncate t-body-compact text-fg-2">{draft.attachment.kind === "document" ? "Прикреплён документ дела" : "Прикреплена задача дела"}</span>
          <button type="button" className={CHIP_CLOSE} aria-label="Убрать вложение" onClick={() => persist({ ...draft, attachment: null })}>
            <Icon name="x" size={16} className="shrink-0" />
          </button>
        </div>
      ) : null}

      {/* Одна рамка, как у чата WhatsApp: «Шаблон» слева, поле растёт, справа круглая «Отправить» —
          красная, только когда есть что отправить. Фокус рисует рамка, а не поле внутри неё. */}
      <div className="flex items-end gap-1 rounded-card border border-border bg-surface p-1 focus-within:border-control-edge has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-focus-ring">
        {snippets !== null ? (
          <button
            type="button" id={picker.triggerId} popoverTarget={picker.popoverId} style={picker.triggerStyle}
            aria-haspopup="dialog" disabled={!canPick}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-ctl px-2.5 t-label text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:text-fg-3 @max-md:w-11 @max-md:justify-center @max-md:px-0"
          >
            <Icon name="file-text" size={18} className="shrink-0" />
            <span className="@max-md:sr-only">Шаблон</span>
          </button>
        ) : null}
        <label className="sr-only" htmlFor={`${key}-body`}>Сообщение в переписке</label>
        <textarea
          id={`${key}-body`} ref={textarea} value={draft.body} rows={1} maxLength={CASE_CHAT_BODY_LIMIT + 200}
          readOnly={pending || uncertain}
          placeholder="Сообщение…" aria-invalid={tooLong || undefined} data-composer-input=""
          className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 t-body text-fg outline-none placeholder:text-fg-3"
          onChange={(event) => persist({ ...draft, body: event.target.value })}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
            // «/» в пустом поле открывает шаблоны, как кнопка «Шаблон»; сам знак не печатается.
            if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
              if (!canPick || draft.body !== "") return;
              event.preventDefault();
              openPicker();
              return;
            }
            // Клавиши те же, что у чата WhatsApp (решение владельца 24.10.2026): Enter или Ctrl/⌘+Enter
            // отправляют, Shift+Enter — новая строка; на сенсорном экране Enter — новая строка.
            if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
            const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
            if (coarse && !event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            if (canSend && !uncertain) event.currentTarget.form?.requestSubmit();
          }}
        />
        {uncertain ? (
          <button type="submit" disabled={!canSend} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-ctl bg-accent px-4 t-label text-on-accent hover:bg-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-3">
            Повторить
          </button>
        ) : (
          <button type="submit" disabled={!canSend} aria-label={pending ? "Отправляем…" : "Отправить"}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-3">
            <Icon name={pending ? "clock" : "send"} size={20} className="shrink-0" />
          </button>
        )}
      </div>
      {tooLong ? <p role="alert" className="mt-1 t-body-compact text-danger">Сократите сообщение до {CASE_CHAT_BODY_LIMIT} символов.</p> : null}
      {state.status !== "idle" && state.status !== "saved" ? <p role="alert" className="mt-1 t-body-compact text-danger">{CASE_CHAT_FAILURE_COPY[state.status]}</p> : null}
      {storageError ? <p className="mt-1 t-body-compact text-fg-3">Браузер не сохраняет черновик в этой вкладке.</p> : null}
      {snippets !== null ? (
        <div
          id={picker.popoverId} popover="auto" role="dialog" aria-label="Шаблон ответа" style={picker.popoverStyle}
          data-testid="case-chat-snippet-popover"
          className="v3-anchored w-[min(24rem,calc(100vw-1rem))] rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg"
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
            <p role="alert" className="p-2 t-body-compact text-danger">Шаблоны не загрузились. Обновите страницу.</p>
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
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2 @2xl:gap-2 @2xl:p-3" data-testid="case-chat-thread-header">
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
        <Link href={`/v3/profile?case=${caseId}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-nav px-2 t-label text-fg underline decoration-fg-3 underline-offset-2 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
          Открыть дело
        </Link>
      </div>
      {awaitState !== null ? (
        /* Подпись «Состояние» отличает запись от фильтра очереди — только широко (узко группа
           названа для читалки, подпись отняла бы строку у ленты): три равные части на всю
           ширину (слово может встать в две строки), широко — по ширине слов. */
        <div className="flex items-center gap-3">
          <span className="hidden t-label text-fg-3 @2xl:inline" aria-hidden="true">Состояние</span>
          <div role="group" aria-label="Состояние переписки" data-testid="case-chat-await-control"
            className="grid w-full grid-cols-3 gap-0.5 rounded-ctl border border-border bg-surface-2 p-0.5 @2xl:flex @2xl:w-fit">
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

function AttachmentCard({ message, caseId, documentsAwaitCurator }: Readonly<{ message: CaseChatMessage; caseId: string; documentsAwaitCurator: boolean }>) {
  if (!message.attachmentKind || !message.attachmentId) return null;
  // У дела без куратора вкладки «Документы» нет (`caseDocumentsAwaitCurator`, считает страница): метка и причина вместо ссылки.
  if (message.attachmentKind === "document" && documentsAwaitCurator) {
    return (
      <div className="mt-1.5 flex min-h-11 items-center gap-2 rounded-ctl border border-border bg-surface px-3 py-2 t-body-compact text-fg" data-testid="case-chat-attachment-await">
        <Icon name="folder" size={16} className="shrink-0" />
        <span className="min-w-0">
          <span className="block truncate">{message.attachmentLabel ?? "Документ дела"}</span>
          <span className="block t-meta text-fg-3">Документы {caseDocumentsWords.awaitCurator}.</span>
        </span>
      </div>
    );
  }
  const href = message.attachmentKind === "document"
    ? `/v3/profile?case=${caseId}&tab=documents`
    : `/v3/tasks?task=${message.attachmentId}&kind=case&case=${caseId}`;
  return (
    <Link href={href} className="mt-1.5 flex min-h-11 items-center gap-2 rounded-ctl border border-border bg-surface px-3 py-2 t-body-compact text-fg underline decoration-transparent hover:decoration-inherit">
      <Icon name={message.attachmentKind === "document" ? "folder" : "check-square"} size={16} />
      <span className="truncate">{message.attachmentLabel ?? (message.attachmentKind === "document" ? "Документ дела" : "Задача дела")}</span>
    </Link>
  );
}

/**
 * Сообщение ленты — та же грамматика, что у чата WhatsApp: чужое — белый лист с
 * волосяной рамкой слева, наше — нейтральное «выбрано» справа (не красное), время
 * в строке под текстом. Автор подписан только у чужих сообщений: наше слева не
 * нуждается в «Вы». «Ответить с цитатой» — один знак в строке времени, цель
 * 44 px, а строка от неё не растёт; мышью он проявляется при наведении и фокусе,
 * на сенсорном экране виден всегда.
 */
function MessageRow({
  message, own, caseId, documentsAwaitCurator, onReply,
}: Readonly<{ message: CaseChatMessage; own: boolean; caseId: string; documentsAwaitCurator: boolean; onReply: (message: CaseChatMessage) => void }>) {
  return (
    <div className={`group flex py-1 ${own ? "justify-end" : "justify-start"}`} id={`case-message-${message.id}`}>
      <div className={`min-w-0 max-w-[min(36rem,85%)] rounded-ctl px-3 py-2 ${own ? "bg-accent-weak" : "border border-border bg-surface"}`}>
        {own ? <span className="sr-only">Вы. </span> : <p className="t-meta font-medium text-fg-2">{message.authorName}</p>}
        {message.quotedPreview ? (
          <p className="mt-1 truncate border-s-2 border-border ps-2 t-meta text-fg-3">
            {message.quotedPreview.authorName}: {message.quotedPreview.bodyPreview}
          </p>
        ) : null}
        {message.body ? <p className="mt-0.5 whitespace-pre-wrap break-words t-body-compact text-fg">{message.body}</p> : null}
        <AttachmentCard message={message} caseId={caseId} documentsAwaitCurator={documentsAwaitCurator} />
        <div className="mt-1 flex items-center justify-end gap-1 t-meta text-fg-3">
          <time dateTime={message.createdAt} className="tabular-nums">{TIME.format(new Date(message.createdAt))}</time>
          <button type="button" aria-label="Ответить с цитатой" title="Ответить с цитатой" onClick={() => onReply(message)}
            className="-my-3.5 -me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-3 hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:opacity-100">
            <Icon name="quote" size={16} className="shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CaseChatThreadView({
  caseId, initialPage, initialFailure, storageScope, membershipId, pendingAttachment, onAttachmentConsumed,
  organizationId, realtimeConfig, studentDisplayName, listHref, onListChanged, facts, snippets, documentsAwaitCurator, readAt, Header,
}: Readonly<{
  caseId: string; initialPage: CaseChatPage | null; initialFailure: CaseChatFailure | null; readAt: string;
  storageScope: string; membershipId: string; pendingAttachment: CaseChatPendingAttachment | null;
  onAttachmentConsumed: () => void; organizationId: string; realtimeConfig: SupabasePublicConfig;
  studentDisplayName: string | null; listHref: string; onListChanged: () => void;
  facts: CaseChatCaseFacts | null; snippets: CaseChatSnippets; documentsAwaitCurator: boolean;
  /** Шапка переписки рамки (прежняя `ThreadHeader` или шапка «Нового вида»): движок один. */
  Header: ComponentType<CaseChatHeaderProps>;
}>) {
  const [page, setPage] = useState<CaseChatPage | null>(initialPage);
  const [error, setError] = useState<CaseChatFailure | null>(initialFailure);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<CaseChatMessage | null>(null);
  const [awaitPending, setAwaitPending] = useState(false);
  const [awaitState, setAwaitState] = useState<CaseChatAwaitState | null>(initialPage?.thread.awaitState ?? null);
  const viewport = useRef<HTMLDivElement>(null);
  // Сотрудник у конца ленты (или только что отправил): новое сообщение видно сразу; иначе — «Новые сообщения».
  const nearBottom = useRef(true);
  const newestId = page?.messages[0]?.id ?? null;
  const [view, setView] = useState({ atBottom: true, seenNewest: newestId });
  const showNew = !view.atBottom && newestId !== view.seenNewest;
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

  // Scroll: pinned to bottom on load; the saved position is restored once per case mount.
  useEffect(() => {
    const key = scrollStorageKey(storageScope, caseId);
    const node = viewport.current;
    if (!node) return;
    let restored = false;
    try {
      const saved = localStorage.getItem(key);
      if (saved) { const value = Number(saved); if (Number.isFinite(value)) { node.scrollTop = value; restored = true; } }
    } catch { /* ignore */ }
    if (!restored) node.scrollTop = node.scrollHeight;
    nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Новое сообщение внизу: лента идёт за ним, если сотрудник был внизу.
  const followed = useRef(newestId);
  useLayoutEffect(() => {
    if (followed.current === newestId) return;
    followed.current = newestId;
    const node = viewport.current;
    if (node && nearBottom.current) node.scrollTop = node.scrollHeight;
  }, [newestId]);

  function onFeedScroll() {
    const node = viewport.current;
    if (!node) return;
    try { localStorage.setItem(scrollStorageKey(storageScope, caseId), String(node.scrollTop)); } catch { /* ignore */ }
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    nearBottom.current = atBottom;
    if (atBottom) {
      if (!view.atBottom || view.seenNewest !== newestId) setView({ atBottom: true, seenNewest: newestId });
    } else if (view.atBottom) {
      setView((previous) => ({ ...previous, atBottom: false }));
    }
  }

  function jumpToNewest() {
    const node = viewport.current;
    if (!node) return;
    nearBottom.current = true;
    node.scrollTo({ top: node.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

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

  // Сбой чтения: предложение понятно, повтор — одной кнопкой, без перезагрузки страницы.
  const failureNotice = error ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <p role="alert" className="t-body-compact text-danger">{CASE_CHAT_FAILURE_COPY[error]}</p>
      {error === "unavailable" ? (
        <button type="button" onClick={() => void refresh()} className={QUEUE_SECONDARY}>Повторить</button>
      ) : null}
    </div>
  ) : null;

  if (!page) {
    return <div className="flex min-w-0 flex-1 flex-col">
      <Header name={studentDisplayName} facts={facts} caseId={caseId} listHref={listHref}
        awaitState={null} onSetAwait={() => {}} awaitPending={false} />
      {failureNotice ?? <p role="alert" className="p-4 t-body-compact text-danger">{CASE_CHAT_FAILURE_COPY.unavailable}</p>}
    </div>;
  }

  const messages = [...page.messages].reverse();
  let currentDay = "";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Header
        name={studentDisplayName} facts={facts} caseId={caseId} listHref={listHref}
        awaitState={awaitState ?? page.thread.awaitState} onSetAwait={changeAwait} awaitPending={awaitPending} />
      {failureNotice}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* `relative`: абсолютные `sr-only` внутри ленты («Вы.») привязаны к ленте и обрезаются ею, а не к обёртке выше — иначе они растягивают страницу. */}
        <div ref={viewport} onScroll={onFeedScroll} className="relative min-h-0 flex-1 overflow-y-auto bg-bg px-3 py-2 @2xl:px-5" aria-label="История переписки">
          {page.hasMore ? <div className="flex justify-center"><button type="button" disabled={busy || stale} onClick={() => void loadOlder()}
            className="my-2 inline-flex min-h-11 items-center rounded-ctl border border-border bg-surface px-3 t-label text-fg-2 hover:text-fg disabled:cursor-wait disabled:text-fg-3">
            {busy ? "Загружаем…" : "Показать более ранние"}
          </button></div> : null}
          {messages.length ? messages.map((message) => {
            const key = dayKey(message.createdAt);
            const divider = key && key !== currentDay;
            if (key) currentDay = key;
            return (
              <div key={message.id}>
                {divider ? <div className="my-2 flex justify-center"><span className="rounded-card bg-surface-2 px-3 py-1 t-meta text-fg-3">{dayLabel(message.createdAt, readAt)}</span></div> : null}
                <MessageRow message={message} own={message.authorMembershipId === membershipId} caseId={caseId}
                  documentsAwaitCurator={documentsAwaitCurator} onReply={(target) => setReplyTo(target)} />
              </div>
            );
          }) : <p className="py-10 text-center t-body-compact text-fg-3">Сообщений пока нет.</p>}
        </div>
        {showNew ? (
          <button type="button" onClick={jumpToNewest}
            className="v3-raised absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-4 t-label text-fg hover:bg-surface-2">
            Новые сообщения
            <Icon name="chevron-down" size={16} className="shrink-0" />
          </button>
        ) : null}
      </div>
      <CaseChatComposer caseId={caseId} storageScope={storageScope} pendingAttachment={pendingAttachment}
        onAttachmentConsumed={onAttachmentConsumed} replyTo={replyTo} onClearReply={() => setReplyTo(null)}
        onSaved={() => { nearBottom.current = true; startTransition(() => { void refresh(); }); }} snippets={snippets} />
    </div>
  );
}

/**
 * Отметки строки словами. Состояние — только в «Всех»: в очереди оно у всех
 * строк одно и ничего не сообщает. «Непрочитанное» — отдельное состояние
 * (чтение 234): чужое сообщение после моей отметки прочтения.
 */
export function threadRowBadges(row: CaseChatThreadRow, queue: CaseChatQueue): { tone: PillTone; text: string }[] {
  const badges: { tone: PillTone; text: string }[] = [];
  if (queue === "all" && row.awaitState !== "none") {
    const text = caseChatAwaitState(row.awaitState);
    if (text) badges.push({ tone: awaitTone(row.awaitState), text });
  }
  return badges;
}

export function queueLabel(queue: CaseChatQueue): string {
  return queue === "all" ? "Все" : caseChatAwaitState(queue) ?? "";
}

function CaseChatList({
  threads, counts, readAt, selectedCaseId, query, onQuery, queue, onQueue, membershipId, hidden, loading, current, failure, onRetry,
}: Readonly<{
  threads: CaseChatThreadsList; counts: CaseChatQueueRead["counts"] | null; readAt: string;
  selectedCaseId: string | null; query: string; onQuery: (value: string) => void;
  queue: CaseChatQueue; onQueue: (value: CaseChatQueue) => void;
  membershipId: string; hidden: boolean; loading: boolean;
  /** Строки прочитаны для нынешних поиска и очереди; иначе сбой скрывает чужие строки. */
  current: boolean; failure: CaseChatFailure | null; onRetry: () => void;
}>) {
  const showRows = !loading && current;
  return (
    <nav aria-label="Переписки кабинета студента" className={`${hidden ? "hidden @2xl:flex" : "flex"} w-full flex-col border-border @2xl:w-[320px] @2xl:shrink-0 @2xl:border-e`}>
      <div className="flex flex-col gap-2 border-b border-border p-3">
        {/* Очереди на виду (Э5): число — из того же чтения, только из полного; «Все» без числа. */}
        <div role="group" aria-label="Очередь переписок" data-testid="case-chat-queues" className="-mx-1 flex flex-wrap">
          {CASE_CHAT_QUEUE_ORDER.map((value) => {
            const count = value === "all" || counts === null ? null : counts[value];
            return (
              <button key={value} type="button" aria-pressed={queue === value} onClick={() => onQueue(value)}
                className="v3-choice inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-nav px-2 t-label text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
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
            className="min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg placeholder:text-fg-3" />
        </form>
      </div>
      {loading ? <p role="status" className="p-4 t-body-compact text-fg-3">Ищем переписки…</p> : null}
      {failure ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
        <p role="alert" className="t-body-compact text-danger">{failure === "forbidden"
          ? "Доступ к перепискам изменился. Обновите страницу."
          : "Не удалось загрузить."}</p>
        {failure === "forbidden" ? null : <button type="button" onClick={onRetry} className={QUEUE_SECONDARY}>Повторить</button>}
      </div> : null}
      <div className="flex-1 overflow-y-auto" aria-busy={loading}>
        {showRows && (threads.rows.length === 0 ? <div className="p-4">
          <p role="status" className="t-body-compact text-fg-3">{query.trim()
            ? queue === "all" ? "По вашему запросу переписок не найдено." : "В этой очереди нет переписок по вашему запросу."
            : queue === "needs_reply" ? "Нет переписок, ждущих ответа." : queue === "all" ? "Переписок пока нет." : "В этой очереди переписок нет."}</p>
          {query.trim() ? <button type="button" onClick={() => onQuery("")} className={`${QUEUE_SECONDARY} mt-2`}>
            Сбросить поиск
          </button> : null}
        </div> : threads.rows.map((row) => {
          const badges = threadRowBadges(row, queue);
          const active = row.studentCaseId === selectedCaseId;
          return (
            <Link key={row.studentCaseId} href={caseChatHref(query, queue, row.studentCaseId)} scroll={false}
              aria-current={active ? "page" : undefined}
              data-case-chat-row={row.studentCaseId}
              className={`flex w-full items-start gap-2.5 border-b border-border px-3 py-3 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring ${active ? "bg-accent-weak" : "hover:bg-surface-2"}`}>
              <span className="mt-0.5 shrink-0"><Initials name={row.studentDisplayName} decorative /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate t-item text-fg">{row.studentDisplayName}</span>
                  {row.lastMessageAt ? <time className="t-meta shrink-0 font-mono tabular-nums text-fg-3" dateTime={row.lastMessageAt}>{rowTime(row.lastMessageAt, readAt)}</time> : null}
                </span>
                {row.lastMessageSnippet ? <span className="truncate t-body-compact text-fg-2">
                  {row.lastMessageAuthorMembershipId === membershipId ? "Вы: " : ""}{row.lastMessageSnippet}
                </span> : <span className="t-body-compact text-fg-3">Нет сообщений</span>}
                {row.unread || badges.length ? <span className="mt-0.5 flex flex-wrap gap-1">
                  {row.unread ? <span className="inline-flex min-h-6 items-center rounded-full bg-fg px-2 t-caption text-surface">Непрочитанное</span> : null}
                  {badges.map((badge) => <StateWord key={badge.text} tone={badge.tone} label={badge.text} />)}
                </span> : null}
              </span>
            </Link>
          );
        }))}
        {showRows && threads.truncated ? <p className="t-meta p-3 text-fg-3">Показаны первые {threads.rows.length}. Уточните поиск.</p> : null}
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

/**
 * Рамка «Переписки»: список слева, шапка переписки и пустая правая часть. Движок (запросы, поиск, живые обновления,
 * черновик, поле ответа, лента) в `CaseChatWorkspace` один; «Новый вид» подставляет свою рамку (`case-chat-next`),
 * прежний вид — эту.
 */
export type CaseChatListProps = Parameters<typeof CaseChatList>[0];
export type CaseChatHeaderProps = Parameters<typeof ThreadHeader>[0];
export type CaseChatIdleProps = Parameters<typeof NextThreadPane>[0];
export type CaseChatFrame = Readonly<{
  List: ComponentType<CaseChatListProps>;
  Header: ComponentType<CaseChatHeaderProps>;
  Idle: ComponentType<CaseChatIdleProps>;
}>;
const LEGACY_FRAME: CaseChatFrame = { List: CaseChatList, Header: ThreadHeader, Idle: NextThreadPane };

export function CaseChatWorkspace({
  organizationId, membershipId, realtimeConfig, initialQueue, initialStudentDisplayName, selectedCaseId, initialPage,
  initialPageFailure, caseFacts = null, snippets = null, documentsAwaitCurator = false, frame = LEGACY_FRAME,
}: Readonly<{
  organizationId: string; membershipId: string; realtimeConfig: SupabasePublicConfig;
  initialQueue: CaseChatQueueRead; selectedCaseId: string | null;
  initialStudentDisplayName: string | null;
  initialPage: CaseChatPage | null; initialPageFailure: CaseChatFailure | null;
  /** Направление и этап открытого дела (строка очереди 241); null — нет строки. */
  caseFacts?: CaseChatCaseFacts | null;
  snippets?: CaseChatSnippets;
  /** Дело ждёт куратора (`caseDocumentsAwaitCurator`, считает страница): вложение-документ без ссылки на вкладку, которой нет. */
  documentsAwaitCurator?: boolean;
  /** Рамка вида; без неё — прежняя. */
  frame?: CaseChatFrame;
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
  // «Ищем…» — только когда поиск или очередь сменились и строк для них ещё нет. Фоновое перечитывание
  // (открытие переписки, отметка прочтения, живое обновление) строки не убирает: список не мигает и не теряет прокрутку.
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<CaseChatFailure | null>(null);
  const [shown, setShown] = useState({ query, queue });
  const shownScope = useRef(shown);
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
      if (result.status === "ready") {
        setQueueRead(result.read); setCountsQuery(value.trim()); setFailure(null);
        const next = { query: value, queue: selectedQueue };
        shownScope.current = next;
        setShown(next);
      } else setFailure(result.status);
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
    void search(scope.current.query, scope.current.queue, sequence);
  }, [search]);

  const invalidateSearch = useCallback(() => {
    clearTimeout(debounceRef.current);
    searchSequence.current += 1;
    setFailure(null);
    setLoading(true);
  }, []);

  // «Повторить» после сбоя: ошибка уступает «Ищем переписки…», иначе повторный сбой выглядел бы как «ничего не произошло».
  const retryList = useCallback(() => {
    setFailure(null);
    setLoading(true);
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    const delay = scope.current.query === query ? 0 : 250;
    scope.current = { query, queue };
    clearTimeout(debounceRef.current);
    const sequence = ++searchSequence.current;
    debounceRef.current = setTimeout(() => {
      if (shownScope.current.query !== query || shownScope.current.queue !== queue) {
        setFailure(null);
        setLoading(true);
      }
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
      // Назад/вперёд в другую очередь или поиск: строк для неё ещё нет — сразу «Ищем…», а не пустой список до таймера.
      if (shownScope.current.query !== scope.current.query || shownScope.current.queue !== scope.current.queue) {
        setFailure(null);
        setLoading(true);
      }
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
      <frame.List threads={threads} counts={counts} readAt={queueRead.readAt} selectedCaseId={selectedCaseId} query={query} onQuery={onQuery}
        queue={queue} onQueue={onQueue}
        membershipId={membershipId} hidden={selectedCaseId !== null} loading={loading} failure={failure} onRetry={retryList}
        current={shown.query === query && shown.queue === queue} />
      {selectedCaseId ? (
        <CaseChatThreadView Header={frame.Header} caseId={selectedCaseId} initialPage={initialPage} initialFailure={initialPageFailure}
          storageScope={`${organizationId}:${membershipId}`} membershipId={membershipId} pendingAttachment={attachment}
          onAttachmentConsumed={consumeAttachment} organizationId={organizationId} realtimeConfig={realtimeConfig}
          studentDisplayName={row?.studentDisplayName ?? initialStudentDisplayName} onListChanged={refreshList}
          listHref={caseChatHref(query, queue)} facts={caseFacts} snippets={snippets} documentsAwaitCurator={documentsAwaitCurator}
          readAt={queueRead.readAt} />
      ) : (
        <frame.Idle read={queueRead} membershipId={membershipId} query={query} queue={queue} loading={loading} failure={failure} />
      )}
    </div>
  );
}
