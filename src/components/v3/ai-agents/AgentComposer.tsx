"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";

import { Icon } from "@/components/icons";
import { StatusChip } from "@/components/v3/blocks/StatusChip";

/** Десять строк поля: дальше оно прокручивается само. */
const MAX_LINES = 10;
/** Счётчик знаков появляется, когда до предела остаётся немного. */
const COUNTER_FROM = 6000;
const DIRECT_NOTE = "Агент отправит сообщения клиентам сразу, без вашего одобрения, на время этого разговора.";

/**
 * Поле поручения «Поручить» (решение владельца 23.10.2026): та же грамматика,
 * что у поля ответа WhatsApp (`InboxComposer`) — одна рамка, слева «Без
 * черновика» (как «Шаблон»), поле растёт до десяти строк, справа круглая
 * кнопка 44 px. Пока агент не работает, это «Отправить» — единственная
 * сплошная красная кнопка и только когда есть что отправлять; пока работает —
 * нейтральная «Остановить агента», а поле остаётся доступным: следующее
 * сообщение можно готовить заранее, но отправить его нельзя.
 *
 * Клавиши: Enter или Ctrl/⌘+Enter отправляют, Shift+Enter — новая строка; на
 * сенсорном экране Enter — новая строка. Набор через IME (`isComposing`, 229)
 * не отправляет. Подсказок о клавишах в интерфейсе нет. Фокус поля рисует
 * рамка. «Без черновика» — выбор при старте разговора (полномочие выдаёт
 * сервер, не модель): внутри начатого разговора он только показывается.
 */
export function AgentComposer({
  fieldId,
  textareaRef,
  value,
  onChange,
  onSend,
  onStop,
  maxChars,
  placeholder,
  working,
  sending,
  hasRun,
  autoSend,
  canDirect,
  direct,
  onDirectChange,
  runAuthority,
  error,
}: Readonly<{
  fieldId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  maxChars: number;
  placeholder: string;
  working: boolean;
  sending: boolean;
  /** Разговор уже начат: «Без черновика» больше не выбирается. */
  hasRun: boolean;
  autoSend: boolean;
  canDirect: boolean;
  direct: boolean;
  onDirectChange: (next: boolean) => void;
  /** У начатого разговора полномочие отправлять без черновика. */
  runAuthority: boolean;
  /** Отказ последней отправки словами. */
  error: string | null;
}>) {
  const composing = useRef(false);
  const noteId = useId();
  const length = value.length;
  const over = length > maxChars;
  const canSend = value.trim().length > 0 && !over && !sending && !working;
  const choosing = canDirect && !hasRun;

  // Поле растёт с текстом до десяти строк, дальше — прокрутка внутри него.
  const fit = useCallback(() => {
    const field = textareaRef.current;
    if (!field || field.getBoundingClientRect().width === 0) return;
    const style = getComputedStyle(field);
    const line = parseFloat(style.lineHeight) || 24;
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    field.style.height = "auto";
    const next = Math.min(field.scrollHeight, line * MAX_LINES + chrome);
    field.style.height = `${next}px`;
    field.style.overflowY = field.scrollHeight > next ? "auto" : "hidden";
  }, [textareaRef]);
  useLayoutEffect(() => { fit(); }, [fit, value, placeholder]);
  // Ширина поля меняется и без набора (поворот, окно, нажатая «Без черновика»): число строк текста и подсказки
  // меняется вместе с ней, а высота иначе осталась бы прежней и обрезала бы текст. Высота на ширину не влияет,
  // поэтому следим только за шириной (так же — поле ответа командного чата), а пересчёт откладываем на кадр.
  useEffect(() => {
    const field = textareaRef.current;
    if (!field || typeof ResizeObserver === "undefined") return undefined;
    let width = field.getBoundingClientRect().width;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const next = field.getBoundingClientRect().width;
      if (next === width) return;
      width = next;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(field);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [fit, textareaRef]);

  return (
    <form
      className="shrink-0 border-t border-border bg-surface px-3 pb-3 pt-2.5 @2xl:px-4"
      aria-label="Поручение агенту"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className="mx-auto w-full max-w-[46rem]">
        {/* Условие выбора видно, когда «Без черновика» нажата, и всегда доступно кнопке через aria-describedby. */}
        {choosing ? <p id={noteId} className={direct ? "mb-2 t-meta text-warn" : "sr-only"}>{DIRECT_NOTE}</p> : null}
        {error ? <p role="alert" className="mb-2 t-body-compact text-danger">{error}</p> : null}
        {/* Фокус поля рисует рамка (одна полоса фокуса мира вокруг всего поля), а не сам textarea внутри неё. */}
        <div className="flex items-end gap-1 rounded-card border border-border bg-surface p-1 @max-md:flex-wrap focus-within:border-control-edge has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-focus-ring">
          {choosing ? (
            <button
              type="button"
              aria-pressed={direct}
              aria-describedby={noteId}
              onClick={() => onDirectChange(!direct)}
              disabled={sending}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-ctl px-2.5 t-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed ${direct ? "bg-warn-weak text-warn @max-md:basis-full" : "text-fg-2 hover:bg-surface-2 hover:text-fg @max-md:w-11 @max-md:justify-center @max-md:px-0"}`}
              data-testid="v3-aia-direct"
            >
              <Icon name="file-text" size={18} className="shrink-0" />
              {/* На узком экране слово остаётся у нажатой кнопки (она занимает свою строку над полем): включённое отправление без одобрения не должно быть значком. */}
              <span className={direct ? undefined : "@max-md:sr-only"}>Без черновика</span>
            </button>
          ) : null}
          <label className="sr-only" htmlFor={fieldId}>Поручение агенту</label>
          <textarea
            id={fieldId}
            ref={textareaRef}
            value={value}
            rows={1}
            maxLength={maxChars}
            readOnly={sending}
            placeholder={placeholder}
            aria-invalid={over || undefined}
            aria-busy={sending || undefined}
            className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 t-body text-fg outline-none placeholder:text-fg-3"
            onChange={(event) => onChange(event.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(event) => {
              const native = event.nativeEvent;
              if (native.isComposing || composing.current || event.keyCode === 229) return;
              if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
              const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
              if (coarse && !event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              if (canSend) onSend();
            }}
            data-composer-input=""
            data-testid="v3-aia-input"
          />
          {/*
            Одна кнопка на оба дела: «Отправить» и «Остановить агента» сменяют друг друга
            плавным наложением значков (120 мс, без движения — сразу), фокус остаётся на месте.
          */}
          <button
            type={working ? "button" : "submit"}
            disabled={working ? false : !canSend}
            aria-label={working ? "Остановить агента" : "Отправить"}
            aria-busy={sending || undefined}
            onClick={working ? onStop : undefined}
            className={`relative inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none ${working ? "bg-fg text-surface hover:bg-fg-2" : "bg-accent text-on-accent hover:bg-accent-text disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-3"}`}
            data-testid={working ? "v3-aia-stop" : "v3-aia-send"}
          >
            <span aria-hidden="true" className={`absolute inset-0 flex items-center justify-center transition-opacity duration-[120ms] motion-reduce:transition-none ${working || sending ? "opacity-0" : "opacity-100"}`}>
              <Icon name="send" size={20} className="shrink-0" />
            </span>
            <span aria-hidden="true" className={`absolute inset-0 flex items-center justify-center transition-opacity duration-[120ms] motion-reduce:transition-none ${sending ? "opacity-100" : "opacity-0"}`}>
              <Icon name="refresh" size={20} className="shrink-0 motion-safe:animate-spin" />
            </span>
            <span aria-hidden="true" className={`absolute inset-0 flex items-center justify-center transition-opacity duration-[120ms] motion-reduce:transition-none ${working && !sending ? "opacity-100" : "opacity-0"}`}>
              <span className="size-3 rounded-[3px] bg-current" />
            </span>
          </button>
        </div>
        <div className="mt-1.5 flex min-h-4 items-center justify-between gap-3 t-meta text-fg-3">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {autoSend
              ? <span><span className="text-warn">Авто вкл</span> · агент отправляет клиентам сам</span>
              : <span>Авто выкл · сообщения клиентам — в «Черновики»</span>}
            {hasRun && runAuthority ? <StatusChip label="Без черновика" tone="warn" /> : null}
          </p>
          <span className={`shrink-0 tabular-nums ${over ? "text-danger" : ""}`}>{length > COUNTER_FROM ? `${length} из ${maxChars}` : ""}</span>
        </div>
      </div>
    </form>
  );
}
