import Link from "next/link";

import { Icon } from "@/components/icons";
import { btnGhostCls } from "@/components/ui";
import { StageChip } from "@/components/v3/blocks/StatusChip";
import type { InboxAssistantConfig } from "@/components/v3/inbox/InboxAiAssistant";
import { InboxChat, type InboxChatData } from "@/components/v3/inbox/InboxChat";
import { InboxListPulse } from "@/components/v3/inbox/InboxListPulse";
import { Pill } from "@/components/v3/Pill";
import type { ReplySnippetPickerItem } from "@/components/v3/reply-snippets/ReplySnippetPicker";
import type { V3InboxMediaAttachmentContext } from "@/lib/v3/inbox-media";
import type { StagePhase } from "@/lib/v3/stages";

export type InboxCanonicalContext = Readonly<{
  leadId: string | null;
  clientId: string | null;
  studentCaseId: string | null;
}>;

export type InboxConversation = Readonly<{
  id: string;
  /**
   * Имя из профиля WhatsApp (или набранное сотрудником), без имени —
   * «WhatsApp»; без номера (не WhatsApp-чат, номер неизвестен) — тема чата.
   */
  person: string;
  /** «+996 ••• 12 46 64»: код страны и последние шесть цифр (миграция 278). */
  phone: string | null;
  /** Kept for server command scope; intentionally not rendered as a raw role. */
  queue: "sales" | "admissions";
  /** Kept in the model; intentionally omitted while it adds no operator decision. */
  status: "open" | "closed";
  updatedAt: string;
  waitingSince: string | null;
  awaitingReplyFor: string | null;
  href: string;
}>;

/** Чат открытой переписки (решение владельца 06.10.2026, миграция 266). */
export type InboxChatModel = InboxChatData & Readonly<{
  /** Этап лида словами доски; null — лида нет или его не прочитать. */
  stage: Readonly<{ label: string; phase: StagePhase | null }> | null;
  /** Ночью в этом чате по-настоящему отвечает автоответчик (P4); нет данных — false. */
  autoreplyAtNight?: boolean;
}>;

export type InboxSelectedConversation = InboxConversation &
  Readonly<{
    /**
     * `not_connected` — сессии WhatsApp для CRM нет вовсе; `unknown` — диалог
     * из прежней сессии, о которой CRM состояния не знает; `intake_off` —
     * сессия работает, но приём сообщений выключен на сервере.
     */
    channelState: "ready" | "attention" | "not_connected" | "unknown" | "unavailable" | "intake_off";
    canonicalContext: InboxCanonicalContext;
    chat: InboxChatModel;
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
  /** Подпись первой страницы списка для опроса; null — открыта более ранняя страница. */
  listPulse: string | null;
}>;

/**
 * Исправный WhatsApp не подписывается: строку о подключении и времени
 * последней проверки владелец убрал 07.10.2026 («уберем давай это»). Беда —
 * не подключён, приём выключен, состояние не прочитать — видна всегда.
 */
function channelWarning(
  state: InboxSelectedConversation["channelState"],
): string | null {
  if (state === "ready") return null;
  if (state === "intake_off") return "Приём сообщений выключен на сервере";
  if (state === "attention") return "WhatsApp требует проверки";
  if (state === "unavailable") return "Не удалось получить состояние WhatsApp";
  if (state === "not_connected") return "WhatsApp не подключён к CRM";
  return "Состояние WhatsApp не подтверждено";
}

/** Номер для читалки: «+996, скрыто, 12 46 64» вместо трёх «bullet». */
function spokenPhone(phone: string): string {
  return phone.replace(" ••• ", ", скрыто, ");
}

function ContactPhone({ phone, className }: Readonly<{ phone: string; className: string }>) {
  return (
    <span className={className} data-testid="v3-inbox-contact-phone">
      <span aria-hidden="true">{phone}</span>
      <span className="sr-only">{spokenPhone(phone)}</span>
    </span>
  );
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

/**
 * «Продажи → WhatsApp» — чат как WhatsApp Web (решение владельца 06.10.2026):
 * слева список диалогов с поиском и «Только ждут ответа», справа лента
 * открытого диалога и поле ответа внизу. Прежнего блока «Ответ и отправка»
 * (ИИ-черновик, подтверждение одной отправки) и панели синхронизации с
 * внешней CRM здесь больше нет. На телефоне — один слой: список, затем чат с
 * «Назад».
 */
export function Inbox({
  view,
  profileHref,
  profileLabel = "Открыть профиль",
  settingsHref = null,
  storageScope,
  replySnippets = null,
  mediaAttachmentContext = null,
  assistant = null,
}: Readonly<{
  view: InboxView;
  profileHref: string | null;
  /** «Карточка лида» или «Открыть дело» — по тому, куда ведёт ссылка. */
  profileLabel?: string;
  /** Только Администратору вне просмотра роли. */
  settingsHref?: string | null;
  /** «организация:сотрудник» — черновики и очередь отправки этого сотрудника. */
  storageScope: string;
  replySnippets?: readonly ReplySnippetPickerItem[] | null;
  mediaAttachmentContext?: V3InboxMediaAttachmentContext | null;
  /** Окно ИИ (план ИИ-агента §12.1): null — у сотрудника нет права ai.agent.use. */
  assistant?: InboxAssistantConfig | null;
}>) {
  const open = view.selected;
  const listWarning = channelWarning(view.channelState);
  const openWarning = open ? channelWarning(open.channelState) : null;
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
      className={`v3-inbox grid min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-surface ${
        open || hasConversations ? "@4xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]" : ""
      }`}
      data-testid="v3-inbox"
      data-source="supabase-platform"
      data-inbox-open={open ? "" : undefined}
    >
      <section
        aria-label="Диалоги"
        className={`flex min-h-0 min-w-0 flex-col border-border @4xl:border-e ${
          open ? "hidden @4xl:flex" : ""
        }`}
      >
        {!open && listWarning ? (
          <div
            className="border-b border-border bg-warn-weak px-4 py-3"
            role="status"
            data-testid="v3-inbox-channel-status"
          >
            <p className="t-body-compact text-warn">{listWarning}</p>
          </div>
        ) : null}
        {!open ? (
          <InboxListPulse listPulse={view.listPulse} searchQuery={view.searchQuery} waitingOnly={view.waitingOnly} />
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
          <div className="flex gap-2">
            <input
              id="v3-inbox-search"
              name="q"
              type="search"
              maxLength={200}
              defaultValue={view.searchQuery ?? ""}
              placeholder="Имя, телефон или тема"
              className="min-h-11 min-w-0 flex-1 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg placeholder:text-fg-3"
            />
            <button type="submit" className={btnGhostCls}>
              Найти
            </button>
          </div>
          <Link
            href={view.waitingToggleHref}
            aria-current={view.waitingOnly ? "true" : undefined}
            className={`mt-2 inline-flex min-h-11 items-center rounded-ctl border px-3 t-label ${
              view.waitingOnly
                ? "border-warn/30 bg-warn-weak text-warn"
                : "border-border text-fg-2 hover:bg-surface-2 hover:text-fg"
            }`}
            data-testid="v3-inbox-waiting-filter"
          >
            {view.waitingOnly ? "Показать все" : "Только ждут ответа"}
          </Link>
        </form>

        {view.queueNewestHref || view.queueOlderHref ? (
          <nav
            aria-label="Страницы диалогов"
            className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3 py-1"
          >
            {view.queueNewestHref ? (
              <Link
                href={view.queueNewestHref}
                className="inline-flex min-h-11 items-center rounded-ctl px-2 t-label text-fg-2 hover:bg-surface-2"
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
                className="inline-flex min-h-11 items-center rounded-ctl px-2 t-label text-fg-2 hover:bg-surface-2"
                data-testid="v3-inbox-queue-older"
              >
                Ранее →
              </Link>
            ) : null}
          </nav>
        ) : null}

        <ol className="min-h-0 flex-1 overflow-y-auto">
          {view.conversations.map((conversation) => {
            const active = conversation.id === open?.id;
            return (
              <li
                key={conversation.id}
                className="border-b border-border"
                data-testid="v3-inbox-row"
                data-conversation-id={conversation.id}
              >
                <Link
                  href={conversation.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-16 w-full flex-col justify-center gap-0.5 px-4 py-2.5 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring ${
                    active ? "bg-accent-weak" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate t-item text-fg">
                      {conversation.person}
                    </span>
                    <span className="t-meta shrink-0 font-mono tabular-nums text-fg-3">
                      {conversation.updatedAt}
                    </span>
                  </span>
                  {conversation.phone ? (
                    <ContactPhone phone={conversation.phone} className="t-meta tabular-nums text-fg-2" />
                  ) : null}
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
              <p className="mt-2 max-w-prose t-body-compact text-fg-2">
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
          aria-label={`Переписка: ${open.person}${open.phone ? `, ${spokenPhone(open.phone)}` : ""}`}
          className="v3-inbox-thread flex min-h-0 min-w-0 flex-col"
          data-testid="v3-inbox-thread"
          data-conversation-id={open.id}
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5 @2xl:px-4">
            <Link
              href={view.queueCurrentHref}
              aria-label="Назад к списку диалогов"
              className="-ms-1 inline-flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg @4xl:hidden"
            >
              <Icon name="arrow-left" size={20} />
            </Link>
            <div className="min-w-0 flex-1">
              {/* Имя не сжимается первым: при нехватке ширины чипы
                  переносятся на свою строку, а имя остаётся целым. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="t-section min-w-0 break-words text-fg">{open.person}</h2>
                {open.chat.stage ? (
                  <StageChip label={open.chat.stage.label} phase={open.chat.stage.phase} />
                ) : null}
                {open.chat.autoreplyAtNight ? (
                  <span className="contents" data-testid="v3-inbox-autoreply-chip">
                    <Pill tone="neutral">
                      <Icon name="moon" size={12} className="me-1 shrink-0" />
                      Ночью отвечает автоответчик
                    </Pill>
                  </span>
                ) : null}
                {open.waitingSince ? (
                  <Pill tone="warn">
                    Ждёт ответа{open.awaitingReplyFor ? ` · ${open.awaitingReplyFor}` : ""}
                  </Pill>
                ) : null}
              </div>
              {open.phone ? (
                <ContactPhone phone={open.phone} className="mt-0.5 block t-meta tabular-nums text-fg-2" />
              ) : null}
              {openWarning ? (
                <p className="mt-0.5 t-meta text-warn" role="status" data-testid="v3-inbox-thread-channel">
                  {openWarning}
                </p>
              ) : null}
            </div>
            {profileHref ? (
              <Link
                href={profileHref}
                className="inline-flex min-h-11 shrink-0 items-center rounded-ctl px-2.5 t-label text-fg underline decoration-fg-3 underline-offset-2 hover:decoration-fg"
                data-testid="v3-inbox-profile-link"
              >
                {profileLabel}
              </Link>
            ) : null}
          </header>
          <InboxChat
            key={open.id}
            conversationId={open.id}
            person={open.person}
            chat={open.chat}
            listPulse={view.listPulse}
            searchQuery={view.searchQuery}
            waitingOnly={view.waitingOnly}
            storageScope={storageScope}
            replySnippets={replySnippets}
            mediaAttachmentContext={mediaAttachmentContext}
            assistant={assistant}
          />
        </section>
      ) : hasConversations ? (
        <section className="hidden place-items-center bg-bg p-8 text-center @4xl:grid">
          <p className="t-body text-fg-3">Выберите диалог слева</p>
        </section>
      ) : null}
    </div>
  );
}
