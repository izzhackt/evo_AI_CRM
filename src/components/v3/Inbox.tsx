import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnGhostCls } from "@/components/ui";
import { InboxMessageMedia } from "@/components/v3/inbox/InboxMessageMedia";
import { Pill } from "@/components/v3/Pill";
import type {
  V3InboxMediaAttachmentContext,
  V3InboxMessageMedia,
} from "@/lib/v3/inbox-media";

export type InboxMessage = Readonly<{
  id: string;
  inbound: boolean;
  body: string;
  /** `30.08 09:14`; null means the canonical timestamp is unavailable. */
  at: string | null;
  media: readonly V3InboxMessageMedia[];
}>;

export type InboxCanonicalContext = Readonly<{
  leadId: string | null;
  clientId: string | null;
  studentCaseId: string | null;
}>;

export type InboxConversation = Readonly<{
  id: string;
  person: string;
  /** Kept for server command scope; intentionally not rendered as a raw role. */
  queue: "sales" | "admissions";
  /** Kept in the model; intentionally omitted while it adds no operator decision. */
  status: "open" | "closed";
  updatedAt: string;
  waitingSince: string | null;
  awaitingReplyFor: string | null;
  href: string;
}>;

export type InboxSelectedConversation = InboxConversation &
  Readonly<{
    messages: readonly InboxMessage[];
    latestInboundSourceMessageId: string | null;
    newestMessagesHref: string | null;
    olderMessagesHref: string | null;
    /**
     * `not_connected` — сессии WhatsApp для CRM нет вовсе; `unknown` — диалог
     * из прежней сессии, о которой CRM состояния не знает.
     */
    channelState: "ready" | "attention" | "not_connected" | "unknown" | "unavailable";
    channelObservedAt: string | null;
    canonicalContext: InboxCanonicalContext;
  }>;

export type InboxView = Readonly<{
  conversations: readonly InboxConversation[];
  selected: InboxSelectedConversation | null;
  queueCurrentHref: string;
  queueNewestHref: string | null;
  queueOlderHref: string | null;
  searchQuery: string | null;
  waitingOnly: boolean;
  waitingToggleHref: string;
  channelState: InboxSelectedConversation["channelState"];
  channelObservedAt: string | null;
}>;

function channelLabel(
  state: InboxSelectedConversation["channelState"],
): string {
  if (state === "ready") return "WhatsApp подключён";
  if (state === "attention") return "WhatsApp требует проверки";
  if (state === "unavailable") return "Не удалось получить состояние WhatsApp";
  if (state === "not_connected") return "WhatsApp не подключён к CRM";
  return "Состояние WhatsApp не подтверждено";
}

/**
 * WhatsApp не подключён и диалогов нет: вместо статуса, поиска и пустого
 * списка — одно честное состояние. Ссылку на Настройки видит только
 * Администратор (`settingsHref`), остальным подключать нечем.
 */
export function inboxNotConnected(view: InboxView): boolean {
  return view.channelState === "not_connected"
    && view.selected === null
    && view.conversations.length === 0
    && !view.searchQuery
    && !view.waitingOnly
    && view.queueNewestHref === null;
}

export function Inbox({
  view,
  profileHref,
  settingsHref = null,
  workflowControls,
  amoCrmControls,
  mediaAttachmentContext = null,
}: Readonly<{
  view: InboxView;
  profileHref: string | null;
  /** Только Администратору вне просмотра роли. */
  settingsHref?: string | null;
  workflowControls?: ReactNode;
  amoCrmControls?: ReactNode;
  mediaAttachmentContext?: V3InboxMediaAttachmentContext | null;
}>) {
  const open = view.selected;
  const hasConversations = view.conversations.length > 0;
  const hasFilters = Boolean(view.searchQuery) || view.waitingOnly;
  if (inboxNotConnected(view)) {
    return (
      <section
        className="rounded-card border border-border bg-surface px-4 py-10 sm:px-6"
        data-testid="v3-inbox-not-connected"
        data-source="supabase-platform"
      >
        <h2 className="t-section text-fg">WhatsApp не подключён к CRM — подключает Администратор</h2>
        {settingsHref ? (
          <Link
            href={settingsHref}
            className="mt-4 inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-4 text-sm font-medium text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            data-testid="v3-inbox-settings"
          >
            Открыть настройки
          </Link>
        ) : null}
      </section>
    );
  }
  const emptyTitle = view.queueNewestHref
    ? "На этой странице диалогов нет"
    : hasFilters
      ? "По выбранным условиям диалогов нет"
      : "Пока нет доступных диалогов";

  return (
    <div
      className={`grid min-h-0 flex-1 gap-4 ${
        open || hasConversations ? "@4xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]" : ""
      }`}
      data-testid="v3-inbox"
      data-source="supabase-platform"
    >
      <section
        aria-label="Диалоги"
        tabIndex={0}
        className={`min-w-0 overflow-y-auto rounded-card border border-border bg-surface ${
          open ? "hidden @4xl:block" : ""
        }`}
      >
        {!open ? (
          <div
            className="border-b border-border px-4 py-3"
            role="status"
            data-testid="v3-inbox-channel-status"
          >
            <p className="text-sm font-medium text-fg-2">
              {channelLabel(view.channelState)}
            </p>
            {view.channelObservedAt ? (
              <p className="mt-1 text-xs text-fg-3">Проверено {view.channelObservedAt}</p>
            ) : null}
          </div>
        ) : null}
        <form
          action="/v3/inbox"
          method="get"
          role="search"
          className="border-b border-border p-3"
        >
          {view.waitingOnly ? (
            <input type="hidden" name="waiting" value="1" />
          ) : null}
          <label htmlFor="v3-inbox-search" className="sr-only">
            Найти диалог
          </label>
          <div className="flex max-w-lg gap-2">
            <input
              id="v3-inbox-search"
              name="q"
              type="search"
              maxLength={200}
              defaultValue={view.searchQuery ?? ""}
              placeholder="Имя, телефон или тема"
              className="min-h-10 min-w-0 flex-1 rounded-ctl border border-border bg-canvas px-3 text-sm text-fg outline-none focus:border-accent"
            />
            <button type="submit" className={btnGhostCls}>
              Найти
            </button>
          </div>
          <Link
            href={view.waitingToggleHref}
            className={`mt-2 inline-flex min-h-9 items-center rounded-ctl px-2.5 text-xs font-semibold ${
              view.waitingOnly
                ? "bg-warn-weak text-warn"
                : "bg-surface-2 text-fg-2 hover:text-fg"
            }`}
            data-testid="v3-inbox-waiting-filter"
          >
            {view.waitingOnly ? "Показать все" : "Только ждут ответа"}
          </Link>
        </form>

        {view.queueNewestHref || view.queueOlderHref ? (
          <nav
            aria-label="Страницы диалогов"
            className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs"
          >
            {view.queueNewestHref ? (
              <Link
                href={view.queueNewestHref}
                className="inline-flex min-h-9 items-center rounded-ctl px-2 text-fg-2 hover:bg-surface-2"
                data-testid="v3-inbox-queue-newest"
              >
                ← К новым
              </Link>
            ) : (
              <span />
            )}
            {view.queueOlderHref ? (
              <Link
                href={view.queueOlderHref}
                rel="next"
                className="inline-flex min-h-9 items-center rounded-ctl px-2 text-fg-2 hover:bg-surface-2"
                data-testid="v3-inbox-queue-older"
              >
                Ранее →
              </Link>
            ) : null}
          </nav>
        ) : null}

        <ol>
          {view.conversations.map((conversation) => {
            const active = conversation.id === open?.id;
            return (
              <li
                key={conversation.id}
                className="border-b border-border last:border-b-0"
                data-testid="v3-inbox-row"
                data-conversation-id={conversation.id}
              >
                <Link
                  href={conversation.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-20 w-full flex-col justify-center gap-1 px-4 py-3 text-start ${
                    active ? "bg-surface-2" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                      {conversation.person}
                    </span>
                    <span className="t-meta shrink-0 font-mono text-fg-3">
                      {conversation.updatedAt}
                    </span>
                  </span>
                  {conversation.waitingSince ? (
                    <span className="t-caption text-warn">
                      Ждёт ответа с {conversation.waitingSince}
                      {conversation.awaitingReplyFor
                        ? ` · ${conversation.awaitingReplyFor}`
                        : ""}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          {!hasConversations ? (
            <li className="px-4 py-10 sm:px-6" data-testid="v3-inbox-empty">
              <h2 className="t-section text-fg">{emptyTitle}</h2>
              <p className="mt-2 max-w-prose text-sm leading-6 text-fg-2">
                {view.queueNewestHref
                  ? "Вернитесь к новым диалогам, чтобы обновить список."
                  : hasFilters
                    ? "Попробуйте другой запрос или сбросьте фильтры."
                    : "Здесь отображаются диалоги, к которым у вас есть доступ."}
              </p>
              {hasFilters && !view.queueNewestHref ? (
                <Link
                  href="/v3/inbox"
                  className="mt-4 inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-4 text-sm font-medium text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  data-testid="v3-inbox-clear-filters"
                >
                  Сбросить фильтры
                </Link>
              ) : null}
            </li>
          ) : null}
        </ol>
      </section>

      {open ? (
        <section
          aria-label={`Переписка: ${open.person}`}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface"
          data-testid="v3-inbox-thread"
          data-conversation-id={open.id}
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
            <Link
              href={view.queueCurrentHref}
              className="-ms-1 grid h-8 w-8 shrink-0 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 @4xl:hidden"
            >
              <span className="sr-only">Назад к списку диалогов</span>
              <Icon name="arrow-left" size={16} />
            </Link>
            <div className="min-w-0 flex-1">
              {/* Имя не сжимается первым: при нехватке ширины пилюля
                  переносится на свою строку, а заголовок остаётся целым. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="t-section min-w-0 text-fg">
                  {open.person}
                </h2>
                {open.waitingSince ? (
                  <Pill tone="warn">
                    Ждёт ответа с {open.waitingSince}
                    {open.awaitingReplyFor ? ` · ${open.awaitingReplyFor}` : ""}
                  </Pill>
                ) : null}
              </div>
              <p className="t-meta mt-0.5 text-fg-3">
                {channelLabel(open.channelState)}
                {open.channelObservedAt
                  ? ` · проверено ${open.channelObservedAt}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {profileHref ? (
                <Link
                  href={profileHref}
                  className="inline-flex min-h-9 items-center rounded-ctl px-2.5 text-xs font-semibold text-accent hover:bg-accent-weak"
                >
                  Открыть профиль
                </Link>
              ) : null}
            </div>
          </header>

          <div
            role="region"
            aria-label="Лента переписки"
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className="px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2 text-xs">
                {open.newestMessagesHref ? (
                  <Link
                    href={open.newestMessagesHref}
                    className="inline-flex min-h-9 items-center rounded-ctl px-2 text-fg-2 hover:bg-surface-2"
                    data-testid="v3-inbox-messages-newest"
                  >
                    ← К новым сообщениям
                  </Link>
                ) : (
                  <span />
                )}
                {open.olderMessagesHref ? (
                  <Link
                    href={open.olderMessagesHref}
                    rel="next"
                    className="inline-flex min-h-9 items-center rounded-ctl px-2 text-fg-2 hover:bg-surface-2"
                    data-testid="v3-inbox-messages-older"
                  >
                    Ранее →
                  </Link>
                ) : null}
              </div>

              <ol
                className="flex flex-col gap-2.5"
                aria-label="Сообщения"
                data-testid="v3-inbox-messages"
              >
                {open.messages.map((message) => (
                  <li
                    key={message.id}
                    className={`max-w-[min(560px,88%)] rounded-ctl px-3 py-2 ${
                      message.inbound
                        ? "self-start border border-border bg-surface-2"
                        : "self-end bg-accent text-on-accent"
                    }`}
                  >
                    <p
                      className={`whitespace-pre-wrap text-sm leading-5 ${
                        message.inbound ? "text-fg" : "text-on-accent"
                      }`}
                    >
                      {message.body}
                    </p>
                    <InboxMessageMedia
                      items={message.media}
                      inbound={message.inbound}
                      attachmentContext={mediaAttachmentContext}
                    />
                    {message.at ? (
                      <p
                        className={`t-meta mt-1 font-mono ${
                          message.inbound ? "text-fg-3" : "text-on-accent"
                        }`}
                      >
                        {message.at}
                      </p>
                    ) : null}
                  </li>
                ))}
                {open.messages.length === 0 ? (
                  <li className="py-8 text-center text-sm text-fg-3">
                    В этой переписке пока нет сообщений.
                  </li>
                ) : null}
              </ol>
            </div>

            {workflowControls ? (
              <div className="border-t border-border px-4 py-5">
                {workflowControls}
              </div>
            ) : null}
            {amoCrmControls ? (
              <div className="border-t border-border px-4 py-5">
                {amoCrmControls}
              </div>
            ) : null}
          </div>
        </section>
      ) : hasConversations ? (
        <section className="hidden place-items-center rounded-card border border-border bg-surface p-8 text-center text-sm text-fg-3 @4xl:grid">
          <div>
            <p className="font-semibold text-fg-2">Выберите диалог</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
