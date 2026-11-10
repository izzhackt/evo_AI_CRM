"use client";

import { Eye, EyeOff } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";

import type { Locale } from "@/lib/i18n-data";

const LABELS = {
  ru: { show: "Показать пароль", hide: "Скрыть пароль" },
  ky: { show: "Сырсөздү көрсөтүү", hide: "Сырсөздү жашыруу" },
  en: { show: "Show password", hide: "Hide password" },
} as const;

export type PasswordInputProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & Readonly<{
  /** Язык подписи кнопки; по умолчанию русский. */
  locale?: Locale;
  /** Готовые подписи (кабинет берёт их из своего словаря); перекрывают `locale`. */
  labels?: Readonly<{ show: string; hide: string }>;
}>;

/**
 * Поле пароля с кнопкой-«глазом» (одно на staff CRM, кабинет студента и вход).
 * Поле остаётся тем же `<input>`: меняется только `type` (password ↔ text), поэтому
 * значение, `name`, `autoComplete`, валидация и менеджеры паролей работают как прежде,
 * а выделение возвращается на место. Внешний вид поля задаёт `className` вызывающего
 * (`inputCls` в staff CRM, `pt-input` в кабинете): компонент добавляет только место под кнопку.
 * Кнопка 44×44, `type="button"` (форму не отправляет), `aria-pressed`, доступна с клавиатуры.
 */
export function PasswordInput({ locale = "ru", labels: given, className, disabled, style, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<readonly [number, number, "forward" | "backward" | "none"] | null>(null);
  const labels = given ?? LABELS[locale] ?? LABELS.ru;

  useLayoutEffect(() => {
    const field = input.current;
    const saved = selection.current;
    selection.current = null;
    if (!field || !saved || document.activeElement !== field) return;
    try {
      field.setSelectionRange(saved[0], saved[1], saved[2]);
    } catch {
      /* тип поля не поддерживает выделение: значение важнее каретки */
    }
  }, [visible]);

  return (
    <span className="evo-pw">
      <input
        {...rest}
        ref={input}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={className}
        // Место под кнопку: inline, чтобы перебить `padding` и `pt-input`, и `inputCls`.
        style={{ ...style, paddingInlineEnd: 44 }}
        // Автозамена и подсказки не должны запоминать открытый пароль.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="evo-pw-toggle"
        aria-label={visible ? labels.hide : labels.show}
        aria-pressed={visible}
        disabled={disabled}
        // Мышью и пальцем: поле не теряет фокус и каретку. С клавиатуры кнопка получает фокус как обычно.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const field = input.current;
          if (field && document.activeElement === field && field.selectionStart !== null && field.selectionEnd !== null) {
            selection.current = [field.selectionStart, field.selectionEnd, field.selectionDirection ?? "none"];
          }
          setVisible((value) => !value);
        }}
      >
        {visible ? <EyeOff size={20} strokeWidth={1.8} aria-hidden="true" /> : <Eye size={20} strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </span>
  );
}
