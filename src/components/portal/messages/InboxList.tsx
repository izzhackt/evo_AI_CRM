import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";

export type InboxView = "chat" | "updates";

/**
 * Левая колонка «Входящих» (03.11.2026, по образцу кабинета, присланного
 * пользователем): лента «Что нового» (уведомления) и переписка с командой
 * EVO. Строка — ссылка на свой вид этой же страницы; открытая отмечена
 * aria-current. Подписи — последнее событие и последнее сообщение из тех же
 * чтений, что рисуют правую колонку; пустое — без подписи.
 */
export function InboxList({ view, updatesPreview, unreadCount, chatPreview, chatTime, locale }: Readonly<{
  view: InboxView;
  updatesPreview: string | null;
  unreadCount: number;
  chatPreview: string | null;
  chatTime: string | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("messages", locale);
  return (
    <ul className="pt-inbox-list" aria-label={strings.listAria}>
      <li>
        <Link
          href="/portal/messages?view=updates"
          aria-current={view === "updates" ? "page" : undefined}
          className="pt-inbox-item"
        >
          <span className="pt-inbox-avatar" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 3a4.5 4.5 0 0 1 4.5 4.5c0 3.2 1 4.5 1.5 5H4c.5-.5 1.5-1.8 1.5-5A4.5 4.5 0 0 1 10 3zM8.5 15.5a1.5 1.5 0 0 0 3 0"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="pt-inbox-item-text">
            <span className="pt-inbox-item-title">{strings.updatesTitle}</span>
            {updatesPreview ? <span className="pt-inbox-item-preview">{updatesPreview}</span> : null}
          </span>
          {unreadCount > 0 ? (
            <span className="pt-inbox-badge">
              <span aria-hidden="true">{unreadCount}</span>
              <span className="pt-sr-only">{formatPortalString(strings.unreadCount, { count: String(unreadCount) })}</span>
            </span>
          ) : null}
        </Link>
      </li>
      <li>
        <Link
          href="/portal/messages"
          aria-current={view === "chat" ? "page" : undefined}
          className="pt-inbox-item"
        >
          <span className="pt-inbox-avatar pt-inbox-avatar-team" aria-hidden="true">EVO</span>
          <span className="pt-inbox-item-text">
            <span className="pt-inbox-item-title">{strings.chatTitle}</span>
            {chatPreview ? <span className="pt-inbox-item-preview">{chatPreview}</span> : null}
          </span>
          {chatTime ? <span className="pt-inbox-time">{chatTime}</span> : null}
        </Link>
      </li>
    </ul>
  );
}
