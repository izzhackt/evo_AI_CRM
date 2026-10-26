/**
 * «На весь экран» для чата «Поручить» (решение владельца 26.10.2026): кнопка на
 * вкладке прячет боковое меню CRM, и чат с агентом занимает всё окно. Выбор
 * запоминается для браузера. Это не полноэкранный режим браузера (Fullscreen
 * API): на iPhone он не работает, а Esc браузер забирает себе.
 *
 * Без React и сервера: оболочка (`AppShell`) и кнопка (`ChatFocus.tsx`) читают
 * готовое, а tests/v3-chat-focus.test.mjs проверяет это в Node.
 */

export const CHAT_FOCUS_STORAGE_KEY = "evo:v3:ai-agent-chat-focus";

/**
 * Значение на время вкладки, когда хранилище браузера недоступно (приватное
 * окно, закрытые данные сайта) или запись в него не прошла: режим работает,
 * но не запоминается. `null` — хранилище отвечает само.
 */
let sessionOnly: boolean | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChatFocus(): boolean {
  const store = storage();
  if (store) {
    try {
      const stored = store.getItem(CHAT_FOCUS_STORAGE_KEY);
      if (stored !== null) return stored === "1";
    } catch {
      /* хранилище не читается — остаётся значение вкладки */
    }
  }
  return sessionOnly ?? false;
}

export function writeChatFocus(on: boolean): void {
  sessionOnly = null;
  const store = storage();
  try {
    if (!store) throw new Error("storage unavailable");
    if (on) store.setItem(CHAT_FOCUS_STORAGE_KEY, "1");
    else store.removeItem(CHAT_FOCUS_STORAGE_KEY);
  } catch {
    sessionOnly = on;
  }
  for (const listener of [...listeners]) listener();
}

/** Подписка для `useSyncExternalStore`: свои записи и изменения из другой вкладки браузера. */
export function subscribeChatFocus(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CHAT_FOCUS_STORAGE_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

type KeyTarget = Readonly<{
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}>;

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "image", "file", "color"]);
const TEXT_ROLES = new Set(["textbox", "combobox", "searchbox"]);

/** Поле, в котором Esc принадлежит самому полю (закрыть список, отменить ввод): текст, список выбора, редактируемая область. */
export function isTextEntryTarget(candidate: unknown): boolean {
  if (typeof candidate !== "object" || candidate === null) return false;
  const target = candidate as KeyTarget;
  const tag = target.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((target.type ?? "text").toLowerCase());
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.("role");
  return typeof role === "string" && TEXT_ROLES.has(role);
}

export type EscapeKeyEvent = Readonly<{
  key: string;
  defaultPrevented: boolean;
  isComposing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** Элемент, получивший клавишу (`KeyboardEvent.target`). */
  target: unknown;
}>;

type OverlayRoot = Readonly<{ querySelector: (selector: string) => unknown }>;

/** Открыто окно, которому принадлежит Esc: диалог, модальный лист или всплывающий слой (уведомления, подсказка). */
export function hasOpenOverlay(root: OverlayRoot): boolean {
  if (root.querySelector('dialog[open], [aria-modal="true"]')) return true;
  try {
    // Старые браузеры не знают `:popover-open` — тогда запрос бросает, и слоя нет.
    return Boolean(root.querySelector(":popover-open"));
  } catch {
    return false;
  }
}

/**
 * Esc возвращает меню, только если он ничей другой: не в поле ввода, не при
 * наборе через IME, не с клавишей-модификатором, не снят другим обработчиком
 * и не при открытом диалоге или всплывающем слое.
 */
export function chatFocusEscapeExits(event: EscapeKeyEvent, root: OverlayRoot): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (isTextEntryTarget(event.target)) return false;
  return !hasOpenOverlay(root);
}
