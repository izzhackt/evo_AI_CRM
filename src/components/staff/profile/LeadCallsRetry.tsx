"use client";

import { useLayoutEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * «Повторить» у строки «Звонки не загрузились» в «Ленте» лида: перечитывает страницу на месте (`router.refresh()`),
 * а не ведёт по ссылке на тот же адрес, которая могла ничего не перечитать. Пока страница читается — «Загрузка…», а
 * повторное нажатие ничего не делает; кнопка остаётся фокусируемой (`aria-disabled`, не `disabled`), иначе фокус
 * терялся бы на время чтения. Получилось — строка с кнопкой исчезает, и фокус не падает на страницу: его принимает
 * заголовок «Лента» (`#lead-feed-title`, `tabIndex=-1`), где лента и обновилась. Не получилось — кнопка остаётся на
 * месте вместе с фокусом.
 */
export function LeadCallsRetry({ className }: Readonly<{ className: string }>) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const button = useRef<HTMLButtonElement>(null);

  // Размонтирование идёт до удаления узла из документа: если фокус стоял на кнопке, его принимает заголовок ленты.
  useLayoutEffect(() => {
    const node = button.current;
    return () => {
      if (node && document.activeElement === node) document.getElementById("lead-feed-title")?.focus();
    };
  }, []);

  return (
    <button ref={button} type="button" className={className} aria-disabled={pending || undefined} data-testid="v3-calls-retry"
      onClick={() => { if (!pending) start(() => router.refresh()); }}>
      {pending ? "Загрузка…" : "Повторить"}
    </button>
  );
}
