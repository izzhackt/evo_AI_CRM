import type { ReactNode } from "react";

/**
 * Общие части карточек «Главной» (08.11.2026, по образцу пользователя): шапка «заголовок слева, переход справа» и
 * пустое состояние «значок в круге, заголовок, одна строка, кнопка». Каждая карточка рисует их одинаково.
 */

// Значки: один штрих 1.5 на сетке 20, те же, что у пунктов меню кабинета.
const ICON_PATHS = {
  // Что сделать сейчас: планшет с отметкой.
  todo: "M6.5 3.5h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM8 3.5V2.8h4v.7M7.7 10.2l1.6 1.6 3-3.3",
  // Мои вузы: здание с колоннами.
  universities: "M3 8l7-4.5L17 8M4.5 8v7M8 8v7M12 8v7M15.5 8v7M3 15h14",
  // Ближайшие даты: календарь.
  calendar: "M4 5.5h12v10.5H4zM4 8.5h12M7 3.5v3M13 3.5v3",
  // Что нового: пузырь диалога, как у «Входящих».
  news: "M3.5 4.5h13v8.5h-7.2L6 16v-3H3.5zM6.8 7.5h6.4M6.8 10h4.4",
} as const;

export type HomeIconName = keyof typeof ICON_PATHS;

export function HomeIcon({ name }: Readonly<{ name: HomeIconName }>) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Шапка карточки: заголовок и число, если оно больше нуля (ноль рядом с пустым состоянием ничего не сообщает). */
export function HomeCardHead({ id, title, count = null, action = null }: Readonly<{
  id: string;
  title: string;
  count?: number | null;
  action?: ReactNode;
}>) {
  return (
    <header className="pt-home-head">
      <h2 id={id} className="pt-home-heading">
        {title}
        {count ? <span className="pt-count">{count}</span> : null}
      </h2>
      {action}
    </header>
  );
}

/** Пустое состояние карточки: что здесь будет и, если есть, что сделать. */
export function HomeEmpty({ icon, title, body = null, action = null }: Readonly<{
  icon: HomeIconName;
  title: string;
  body?: string | null;
  action?: ReactNode;
}>) {
  return (
    <div className="pt-home-empty">
      <span className="pt-home-empty-icon"><HomeIcon name={icon} /></span>
      <p className="pt-home-empty-title">{title}</p>
      {body ? <p className="pt-home-empty-body">{body}</p> : null}
      {action ? <div className="pt-home-empty-action">{action}</div> : null}
    </div>
  );
}
