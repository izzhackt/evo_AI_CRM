"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { QUEUE_CONFIRM, QUEUE_FIELD, QUEUE_SECONDARY } from "./queue-buttons";

/**
 * Окно с одним полем у своей кнопки строки очереди: «Результат» при
 * завершении, «Причина переноса». Enter подтверждает, Esc и «Отмена»
 * закрывают; фокус при открытии — в поле, при закрытии браузер возвращает
 * его на кнопку. Ошибка сервера остаётся в окне вместе с набранным текстом.
 */
export function QueueFieldPopover({
  popover,
  label,
  placeholder,
  submitLabel,
  emptyError,
  onSubmit,
  returnFocusId = null,
}: Readonly<{
  popover: Readonly<{ id: string; style: CSSProperties }>;
  label: string;
  placeholder?: string;
  submitLabel: string;
  /** Текст, если поле пустое: сервер без него команду не примет. */
  emptyError: string;
  /** null — сохранено, окно закрывается; строка — ошибка для показа. */
  onSubmit: (value: string) => Promise<string | null>;
  /**
   * Куда вернуть фокус, если окно открыто скриптом, а не своей кнопкой
   * (например, из меню «⋯», которое к этому моменту уже закрыто).
   */
  returnFocusId?: string | null;
}>) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `${popover.id}-field`;

  useEffect(() => {
    const element = document.getElementById(popover.id);
    if (!element) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") { document.getElementById(inputId)?.focus(); return; }
      setError(null);
      if (!returnFocusId) return;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active === document.body || active.offsetParent === null) {
          document.getElementById(returnFocusId)?.focus();
        }
      });
    };
    element.addEventListener("toggle", onToggle);
    return () => element.removeEventListener("toggle", onToggle);
  }, [popover.id, inputId, returnFocusId]);

  return (
    <div
      id={popover.id}
      popover="auto"
      style={popover.style}
      role="dialog"
      aria-labelledby={`${inputId}-label`}
      className="v3-anchored w-[min(20rem,calc(100vw-1rem))] rounded-ctl border border-border bg-surface p-3 text-fg shadow-evo-lg"
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          if (!value.trim()) { setError(emptyError); return; }
          setPending(true);
          setError(null);
          const failure = await onSubmit(value).catch(() => "Сохранение пока не подтверждено. Повторите.");
          setPending(false);
          if (failure) { setError(failure); return; }
          setValue("");
          document.getElementById(popover.id)?.hidePopover();
        }}
      >
        <label htmlFor={inputId} id={`${inputId}-label`} className="block t-label text-fg-2">{label}</label>
        <input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={1000}
          placeholder={placeholder}
          disabled={pending}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={QUEUE_FIELD}
        />
        {error ? <p id={`${inputId}-error`} role="alert" className="mt-2 t-body-compact text-danger">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={QUEUE_CONFIRM}>{pending ? "Сохраняем…" : submitLabel}</button>
          <button type="button" popoverTarget={popover.id} popoverTargetAction="hide" className={QUEUE_SECONDARY}>Отмена</button>
        </div>
      </form>
    </div>
  );
}
