"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { Icon } from "@/components/icons";
import { useAnchoredPopover } from "@/components/v3/queue/useAnchoredPopover";
import { ReplySnippetPicker, type ReplySnippetPickerItem } from "@/components/v3/reply-snippets/ReplySnippetPicker";
import {
  WHATSAPP_CHAT_COUNTER_FROM,
  WHATSAPP_CHAT_TEXT_LIMIT,
  chatTextLength,
} from "@/lib/v3/whatsapp-chat";

/** Восемь строк поля: дальше оно прокручивается само. */
const MAX_LINES = 8;

/**
 * Поле ответа чата WhatsApp (решение владельца 06.10.2026). Как у
 * «Командного чата»: одна рамка, слева «Шаблон», поле растёт до восьми строк,
 * справа круглая «Отправить» — единственная сплошная красная кнопка страницы.
 *
 * Клавиши: мышь и клавиатура — Enter или Ctrl/⌘+Enter отправляют, Shift+Enter
 * — новая строка; на сенсорном экране Enter — новая строка (отправка —
 * кнопкой). Набор через IME (`isComposing`, 229) не отправляет. «/» в пустом
 * поле открывает шаблоны; Esc закрывает окно шаблонов. Подсказок о клавишах
 * нет (тихий интерфейс, 18.09.2026).
 */
export function InboxComposer({
  fieldId,
  value,
  onChange,
  onSend,
  blocked,
  snippets,
  textareaRef,
  children,
}: Readonly<{
  fieldId: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** Три сообщения уже в пути: новое ждёт, текст остаётся в поле. */
  blocked: boolean;
  /** null — права на шаблоны нет: кнопки нет. */
  snippets: readonly ReplySnippetPickerItem[] | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Строки под полем: отказ, предупреждение канала. */
  children?: React.ReactNode;
}>) {
  const picker = useAnchoredPopover("start");
  const composing = useRef(false);
  const length = chatTextLength(value);
  const tooLong = length > WHATSAPP_CHAT_TEXT_LIMIT;
  const empty = value.trim().length === 0;
  const canSend = !empty && !tooLong && !blocked;

  // Поле растёт с текстом до восьми строк (после вставки шаблона — тоже).
  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    const style = getComputedStyle(field);
    const line = parseFloat(style.lineHeight) || 24;
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    field.style.height = "auto";
    const next = Math.min(field.scrollHeight, line * MAX_LINES + chrome);
    field.style.height = `${next}px`;
    field.style.overflowY = field.scrollHeight > next ? "auto" : "hidden";
  }, [value, textareaRef]);

  // Закрытое окно шаблонов возвращает фокус в поле.
  useEffect(() => {
    const element = document.getElementById(picker.popoverId);
    if (!element) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") {
        element.querySelector<HTMLElement>("select, button")?.focus();
        return;
      }
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || element.contains(active)) textareaRef.current?.focus();
      });
    };
    element.addEventListener("toggle", onToggle);
    return () => element.removeEventListener("toggle", onToggle);
  }, [picker.popoverId, textareaRef]);

  function openPicker() {
    const element = document.getElementById(picker.popoverId);
    if (element && !element.matches(":popover-open")) element.showPopover();
  }

  return (
    <form
      className="v3-inbox-composer shrink-0 border-t border-border bg-surface px-3 pb-3 pt-2.5 @2xl:px-4"
      aria-label="Ответ клиенту"
      data-testid="v3-inbox-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      {children}
      {/* Фокус поля рисует рамка (одна полоса фокуса мира вокруг всего поля), а не сам textarea внутри неё. */}
      <div className="flex items-end gap-1 rounded-card border border-border bg-surface p-1 focus-within:border-control-edge has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-focus-ring">
        {snippets !== null ? (
          <button
            type="button"
            id={picker.triggerId}
            popoverTarget={picker.popoverId}
            style={picker.triggerStyle}
            aria-haspopup="dialog"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-ctl px-2.5 t-label text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring @max-md:w-11 @max-md:justify-center @max-md:px-0"
          >
            <Icon name="quote" size={18} className="shrink-0" />
            <span className="@max-md:sr-only">Шаблон</span>
          </button>
        ) : null}
        <label className="sr-only" htmlFor={fieldId}>Сообщение клиенту</label>
        <textarea
          id={fieldId}
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder="Сообщение…"
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong || length >= WHATSAPP_CHAT_COUNTER_FROM ? `${fieldId}-count` : undefined}
          data-composer-input=""
          className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 t-body text-fg outline-none placeholder:text-fg-3"
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            const native = event.nativeEvent;
            if (native.isComposing || composing.current || event.keyCode === 229) return;
            if (event.key === "/" && value === "" && snippets !== null && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              openPicker();
              return;
            }
            if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
            const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
            if (coarse && !event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            if (canSend) onSend();
          }}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Отправить"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-3"
          data-testid="v3-inbox-send"
        >
          <Icon name="send" size={20} className="shrink-0" />
        </button>
      </div>
      {tooLong || length >= WHATSAPP_CHAT_COUNTER_FROM ? (
        <p id={`${fieldId}-count`} className={`mt-1 text-end t-meta tabular-nums ${tooLong ? "text-danger" : "text-fg-3"}`} role={tooLong ? "alert" : undefined}>
          {tooLong ? `Сократите до ${WHATSAPP_CHAT_TEXT_LIMIT} знаков: сейчас ${length}` : `${length} из ${WHATSAPP_CHAT_TEXT_LIMIT}`}
        </p>
      ) : null}
      {snippets !== null ? (
        <div
          id={picker.popoverId}
          popover="auto"
          role="dialog"
          aria-label="Шаблон ответа"
          style={picker.popoverStyle}
          data-testid="v3-inbox-snippet-popover"
          className="v3-anchored w-[min(24rem,calc(100vw-1rem))] rounded-ctl border border-border bg-surface p-3 text-fg shadow-evo-lg"
        >
          <ReplySnippetPicker
            snippets={snippets}
            messageText={value}
            textareaRef={textareaRef}
            maxCodePoints={WHATSAPP_CHAT_TEXT_LIMIT}
            onMessageTextChange={(next) => {
              onChange(next);
              document.getElementById(picker.popoverId)?.hidePopover();
            }}
          />
        </div>
      ) : null}
    </form>
  );
}
