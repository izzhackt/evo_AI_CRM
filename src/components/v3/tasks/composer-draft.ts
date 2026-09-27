/**
 * Черновик диалога «Новая задача» (Э7): название и описание, которые человек
 * набрал и не отправил. Это удобство одного смотрящего в его браузере
 * (`localStorage`), а не запись: сервер его не видит, другой сотрудник и
 * другое устройство — тоже. Пустое или заблокированное хранилище форму не ломает.
 *
 * Ключ — вид задачи, которую создала бы отправка сейчас:
 * - `case:<id>` — выбранное дело (задача по студенту);
 * - `chat:<messageId>` — рабочая задача из сообщения;
 * - `lead:<leadId>` — рабочая задача по лиду;
 * - `general` — рабочая задача без источника (меню, Ctrl+K, «Задачи», календарь
 *   без дела, дело убрано «Без дела» или раздел «Студент/дело» свёрнут).
 *
 * Черновик идёт за текстом, а не за делом. Выбрать дело, убрать его или
 * свернуть раздел в открытом диалоге — смена ключа, и набранное при ней НЕ
 * теряется:
 * - в полях что-то есть → поля не трогаются; текст переезжает на новый ключ,
 *   а прежний ключ очищается (иначе тот же текст всплыл бы второй раз там,
 *   откуда человек ушёл). Черновик, лежавший под новым ключом, заменяется
 *   набранным — старый черновик никогда не перезаписывает поле;
 * - поля пусты → в них возвращается черновик нового ключа, если он есть: это
 *   текст, набранный раньше для того же дела (того же вида задачи). Черновик
 *   другого дела или другого вида задачи не появляется никогда.
 * При открытии название, набранное до открытия (строка «Новая задача…»),
 * важнее черновика; описание берётся из черновика ключа входа.
 */
export type ComposerDraft = Readonly<{ title: string; description: string }>;

/** Хранилище черновиков; `write` пустого черновика убирает запись. */
export type ComposerDraftStore = Readonly<{
  read(context: string): ComposerDraft | null;
  write(context: string, draft: ComposerDraft): void;
}>;

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = Object.freeze({ title: "", description: "" });

export function composerDraftContext(input: Readonly<{
  /** Дело, по которому создалась бы задача сейчас; пусто — рабочая задача. */
  caseId: string;
  sourceMessageId?: string;
  sourceLeadId?: string;
}>): string {
  if (input.caseId) return `case:${input.caseId}`;
  if (input.sourceMessageId) return `chat:${input.sourceMessageId}`;
  if (input.sourceLeadId) return `lead:${input.sourceLeadId}`;
  return "general";
}

/** Пусто — ни одного набранного символа ни в названии, ни в описании (пробел — тоже ввод). */
export function composerDraftIsEmpty(draft: ComposerDraft): boolean {
  return draft.title === "" && draft.description === "";
}

/** Поля при открытии диалога в контексте `context`. */
export function openComposerDraft(store: ComposerDraftStore, context: string, initialTitle: string): ComposerDraft {
  const stored = store.read(context);
  return { title: initialTitle.trim() || stored?.title || "", description: stored?.description ?? "" };
}

/**
 * Смена ключа в открытом диалоге (`from` → `to`) при полях `current`;
 * возвращает поля после смены. Набранное возвращается тем же объектом:
 * вызывающий не меняет поля, пока в них что-то есть.
 */
export function switchComposerDraft(store: ComposerDraftStore, from: string, to: string, current: ComposerDraft): ComposerDraft {
  if (from === to) return current;
  if (!composerDraftIsEmpty(current)) {
    store.write(from, EMPTY_COMPOSER_DRAFT);
    store.write(to, current);
    return current;
  }
  return store.read(to) ?? current;
}

const STORAGE_PREFIX = "evo-task-composer-draft:";

/** Черновики в `localStorage` этого браузера; сбой хранилища — как пустое хранилище. */
export const browserComposerDraftStore: ComposerDraftStore = {
  read(context) {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + context);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ComposerDraft>;
      if (typeof parsed.title !== "string" || typeof parsed.description !== "string") return null;
      return { title: parsed.title, description: parsed.description };
    } catch { return null; }
  },
  write(context, draft) {
    try {
      if (composerDraftIsEmpty(draft)) window.localStorage.removeItem(STORAGE_PREFIX + context);
      else window.localStorage.setItem(STORAGE_PREFIX + context, JSON.stringify({ title: draft.title, description: draft.description }));
    } catch { /* удобство одного смотрящего: заблокированное хранилище форму не ломает */ }
  },
};
