"use client";

import { useSyncExternalStore } from "react";

import type { LocalChatSend } from "@/lib/v3/whatsapp-chat";

/**
 * Черновик и очередь отправки одного чата в этом браузере (решение владельца
 * 06.10.2026). Хранится в localStorage по ключу «организация · сотрудник ·
 * чат»: перезагрузка не теряет ни текст, ни сообщение, ушедшее на сервер без
 * ответа, — его повтор тем же requestId безопасен (сервер воспроизводит
 * записанный ответ и не отправляет второй раз).
 *
 * Внешнее хранилище, а не состояние React: на сервере и при гидратации оно
 * пустое (`getServerSnapshot`), в браузере — прочитанное, без расхождения
 * разметки и без записи состояния в эффекте.
 */
export type ChatStoreState = Readonly<{
  draft: string;
  local: readonly LocalChatSend[];
  /** Идут на сервер прямо сейчас (не сохраняется). */
  inFlight: readonly string[];
  storageError: boolean;
}>;

const EMPTY: ChatStoreState = Object.freeze({ draft: "", local: Object.freeze([]), inFlight: Object.freeze([]), storageError: false });
const cache = new Map<string, ChatStoreState>();
const listeners = new Map<string, Set<() => void>>();

const STATES = new Set(["sending", "queued", "lost", "sent", "unknown", "rejected", "refused"]);

function parseLocal(value: unknown): LocalChatSend | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.requestId !== "string" || typeof item.text !== "string" || typeof item.sourceMessageId !== "string"
    || typeof item.createdAt !== "string" || typeof item.state !== "string" || !STATES.has(item.state)
  ) return null;
  // Прерванная перезагрузкой отправка ждёт повтора тем же запросом.
  return Object.freeze({
    requestId: item.requestId,
    text: item.text,
    sourceMessageId: item.sourceMessageId,
    createdAt: item.createdAt,
    state: item.state as LocalChatSend["state"],
    messageId: typeof item.messageId === "string" ? item.messageId : null,
    attemptId: typeof item.attemptId === "string" ? item.attemptId : null,
    refusal: typeof item.refusal === "string" ? item.refusal as LocalChatSend["refusal"] : null,
  });
}

function load(key: string): ChatStoreState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as { draft?: unknown; local?: unknown };
    const local = Array.isArray(parsed.local)
      ? parsed.local.map(parseLocal).filter((item): item is LocalChatSend => item !== null).slice(-20)
      : [];
    return Object.freeze({
      draft: typeof parsed.draft === "string" ? parsed.draft : "",
      local: Object.freeze(local),
      inFlight: Object.freeze([]),
      storageError: false,
    });
  } catch {
    return Object.freeze({ ...EMPTY, storageError: true });
  }
}

export function readChatStore(key: string): ChatStoreState {
  let state = cache.get(key);
  if (!state) {
    state = load(key);
    cache.set(key, state);
  }
  return state;
}

export function writeChatStore(key: string, update: (previous: ChatStoreState) => ChatStoreState): void {
  const previous = readChatStore(key);
  let next = update(previous);
  if (next === previous) return;
  try {
    if (next.draft === "" && next.local.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ draft: next.draft, local: next.local }));
    if (next.storageError) next = Object.freeze({ ...next, storageError: false });
  } catch {
    next = Object.freeze({ ...next, storageError: true });
  }
  cache.set(key, next);
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => { set.delete(listener); };
}

export function useChatStore(key: string): ChatStoreState {
  return useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => readChatStore(key),
    () => EMPTY,
  );
}

export function chatStoreKey(scope: string, conversationId: string): string {
  return `evo-whatsapp-chat-v1:${scope}:${conversationId}`;
}

/**
 * Вставка в поле ответа без отправки — шов для будущего окна ИИ (план ИИ-агента
 * §12.1, «Вставить в ответ»): текст добавляется к написанному, ничего не
 * стирается и не отправляется.
 */
export function appendChatDraft(key: string, text: string): void {
  writeChatStore(key, (previous) => ({
    ...previous,
    draft: previous.draft.trim() === "" ? text : `${previous.draft.trimEnd()}\n${text}`,
  }));
}
