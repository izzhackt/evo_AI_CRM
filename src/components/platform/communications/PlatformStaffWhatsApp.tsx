import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState, PageHeader, btnGhostCls, cn } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import type {
  PlatformConversationCursor,
  PlatformConversationMessage,
  PlatformConversationSummary,
  PlatformWahaSessionHealth,
} from "@/lib/platform-communications";

const COPY = {
  ru: {
    title: "WhatsApp · Inbox",
    description:
      "Единая staff-очередь WhatsApp читает диалоги и сообщения из канонической базы EVO в Supabase.",
    queueTitle: "Диалоги",
    queueDescription:
      "Sales видит свою очередь, Admissions — переданные диалоги, а Admin — единый рабочий список.",
    emptyQueue: "Сохранённых диалогов пока нет.",
    emptyThreadTitle: "Выберите диалог",
    emptyThreadText: "Откройте диалог из очереди слева.",
    openConversation: "Открыть диалог",
    updated: "Обновлено",
    studentCase: "Student Case",
    queue: "Очередь",
    status: "Статус",
    created: "Создано",
    channel: "Канал WhatsApp",
    channelReady: "Подключён",
    channelAttention: "Требует проверки",
    channelUnknown: "Состояние не подтверждено",
    channelObserved: "Проверено",
    newestQueue: "К новым диалогам",
    olderQueue: "Более старые диалоги",
    backToQueue: "К списку диалогов",
    newestMessages: "К новым сообщениям",
    olderMessages: "Более старые сообщения",
    transcript: "Переписка WhatsApp",
    transcriptDescription:
      "Сообщения показаны в хронологическом порядке. Действия оператора появляются только в проверенном блоке управления.",
    emptyMessages: "В этой переписке пока нет сообщений.",
    incoming: "Входящее",
    outgoing: "Исходящее · история",
    queueSales: "Sales",
    queueAdmissions: "Admissions",
    statusOpen: "Открыт",
    statusClosed: "Закрыт",
  },
  ky: {
    title: "WhatsApp · Inbox",
    description:
      "Бирдиктүү WhatsApp staff кезеги диалогдорду жана билдирүүлөрдү EVOнун Supabase'тагы канондук базасынан окуйт.",
    queueTitle: "Диалогдор",
    queueDescription:
      "Sales өз кезегин, Admissions өткөрүлгөн диалогдорду, Admin бирдиктүү иш тизмесин көрөт.",
    emptyQueue: "Сакталган диалогдор азырынча жок.",
    emptyThreadTitle: "Диалог тандаңыз",
    emptyThreadText: "Сол жактагы кезектен диалогду ачыңыз.",
    openConversation: "Диалогду ачуу",
    updated: "Жаңыртылды",
    studentCase: "Student Case",
    queue: "Кезек",
    status: "Абал",
    created: "Түзүлдү",
    channel: "WhatsApp каналы",
    channelReady: "Туташкан",
    channelAttention: "Текшерүү керек",
    channelUnknown: "Абалы ырасталган жок",
    channelObserved: "Текшерилди",
    newestQueue: "Жаңы диалогдорго",
    olderQueue: "Эски диалогдор",
    backToQueue: "Диалогдор тизмесине",
    newestMessages: "Жаңы билдирүүлөргө",
    olderMessages: "Эски билдирүүлөр",
    transcript: "WhatsApp кат алышуусу",
    transcriptDescription:
      "Билдирүүлөр хронологиялык тартипте көрсөтүлөт. Оператордун аракеттери текшерилген башкаруу блогунда гана пайда болот.",
    emptyMessages: "Бул кат алышууда билдирүүлөр азырынча жок.",
    incoming: "Кирген",
    outgoing: "Чыккан · тарых",
    queueSales: "Sales",
    queueAdmissions: "Admissions",
    statusOpen: "Ачык",
    statusClosed: "Жабык",
  },
  en: {
    title: "WhatsApp · Inbox",
    description:
      "The single staff WhatsApp queue reads conversations and messages from EVO's canonical Supabase database.",
    queueTitle: "Conversations",
    queueDescription:
      "Sales sees its queue, Admissions sees handed-off conversations, and Admin sees one shared work list.",
    emptyQueue: "There are no persisted conversations yet.",
    emptyThreadTitle: "Select a conversation",
    emptyThreadText: "Open a conversation from the queue on the left.",
    openConversation: "Open conversation",
    updated: "Updated",
    studentCase: "Student Case",
    queue: "Queue",
    status: "Status",
    created: "Created",
    channel: "WhatsApp channel",
    channelReady: "Connected",
    channelAttention: "Needs attention",
    channelUnknown: "State not confirmed",
    channelObserved: "Observed",
    newestQueue: "Newest conversations",
    olderQueue: "Older conversations",
    backToQueue: "Back to conversations",
    newestMessages: "Newest messages",
    olderMessages: "Older messages",
    transcript: "WhatsApp transcript",
    transcriptDescription:
      "Messages are shown chronologically. Staff actions appear only inside the verified workflow controls.",
    emptyMessages: "There are no messages in this conversation yet.",
    incoming: "Incoming",
    outgoing: "Outgoing · history",
    queueSales: "Sales",
    queueAdmissions: "Admissions",
    statusOpen: "Open",
    statusClosed: "Closed",
  },
} as const;

type PlatformStaffWhatsAppThread = Readonly<{
  conversation: PlatformConversationSummary;
  messages: readonly PlatformConversationMessage[];
  wahaSessionHealth: PlatformWahaSessionHealth | null;
  newestMessagesHref: string | null;
  olderMessagesHref: string | null;
}>;

type PlatformStaffWhatsAppWorkspaceProps = Readonly<{
  locale: Locale;
  actorRole: FixedRole;
  conversations: readonly PlatformConversationSummary[];
  queueCursor: PlatformConversationCursor | null;
  queueResetHref: string | null;
  queueNextHref: string | null;
  selectedConversationId?: string | null;
  thread?: PlatformStaffWhatsAppThread | null;
  workflowControls?: ReactNode;
}>;

export function PlatformStaffWhatsAppWorkspace({
  locale,
  actorRole,
  conversations,
  queueCursor,
  queueResetHref,
  queueNextHref,
  selectedConversationId = null,
  thread = null,
  workflowControls,
}: PlatformStaffWhatsAppWorkspaceProps) {
  const copy = COPY[locale];
  const mobileBackHref = queueHref(queueCursor);

  return (
    <div
      className="space-y-4"
      data-testid="platform-staff-whatsapp-page"
      data-source="supabase-platform"
    >
      <PageHeader title={copy.title} description={copy.description} />
      <div className="flex h-[calc(100dvh-var(--staff-chrome,304px))] min-h-[320px] flex-col overflow-hidden rounded-card border border-border bg-surface shadow-evo lg:flex-row">
        <aside
          className={cn(
            "w-full shrink-0 border-b border-border bg-surface-2 lg:block lg:w-[360px] lg:border-r lg:border-b-0",
            thread && "hidden",
          )}
        >
          <div className="border-b border-border px-4 py-4">
            <h2 className="text-base font-semibold text-fg">{copy.queueTitle}</h2>
            <p className="mt-1 max-w-[56ch] text-sm leading-5 text-fg-3">
              {copy.queueDescription}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs">
            {queueResetHref ? (
              <Link
                href={queueResetHref}
                className={btnGhostCls}
                data-testid="platform-staff-whatsapp-queue-reset"
              >
                ← {copy.newestQueue}
              </Link>
            ) : (
              <span />
            )}
            {queueNextHref ? (
              <Link
                href={queueNextHref}
                className={btnGhostCls}
                rel="next"
                data-testid="platform-staff-whatsapp-queue-next"
              >
                {copy.olderQueue} →
              </Link>
            ) : null}
          </div>
          <nav
            className="max-h-[320px] overflow-y-auto lg:max-h-full"
            aria-label={copy.queueTitle}
            tabIndex={0}
            data-testid="platform-staff-whatsapp-queue"
          >
            {conversations.length === 0 ? (
              <EmptyState text={copy.emptyQueue} />
            ) : (
              <ol className="divide-y divide-border">
                {conversations.map((conversation) => {
                  const active = conversation.id === selectedConversationId;
                  return (
                    <li
                      key={conversation.id}
                      data-testid="platform-staff-whatsapp-row"
                      data-conversation-id={conversation.id}
                    >
                      <Link
                        href={conversationHref(conversation.id, queueCursor)}
                        aria-current={active ? "page" : undefined}
                        aria-label={`${copy.openConversation}: ${conversation.subject}`}
                        className={cn(
                          "block px-4 py-3 transition-colors hover:bg-surface",
                          active && "bg-accent-weak",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 truncate text-base font-semibold text-fg">
                            {conversation.subject}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 text-xs",
                              active ? "text-accent-weak-muted" : "text-fg-3",
                            )}
                          >
                            {formatTimestamp(conversation.sortAt, locale)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Pill tone="info">
                            {queueLabel(locale, conversation.queue)}
                          </Pill>
                          <Pill tone="accent">
                            {statusLabel(locale, conversation.status)}
                          </Pill>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </nav>
        </aside>

        <section
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"
          tabIndex={0}
          aria-label={thread ? thread.conversation.subject : copy.emptyThreadTitle}
          data-testid="platform-staff-whatsapp-thread-region"
        >
          {thread ? (
            <>
              <Link
                href={mobileBackHref}
                className={cn(btnGhostCls, "mb-3 inline-flex lg:hidden")}
                data-testid="platform-staff-whatsapp-mobile-back"
              >
                ← {copy.backToQueue}
              </Link>
              <ConversationThread
                actorRole={actorRole}
                locale={locale}
                conversation={thread.conversation}
                messages={thread.messages}
                wahaSessionHealth={thread.wahaSessionHealth}
                newestMessagesHref={thread.newestMessagesHref}
                olderMessagesHref={thread.olderMessagesHref}
                workflowControls={workflowControls}
              />
            </>
          ) : (
            <div
              className="flex h-full flex-col items-center justify-center px-6 text-center"
              data-testid="platform-staff-whatsapp-empty"
            >
              <h2 className="text-lg font-semibold text-fg">
                {copy.emptyThreadTitle}
              </h2>
              <p className="mt-2 max-w-[56ch] text-sm leading-6 text-fg-3">
                {copy.emptyThreadText}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ConversationThread({
  actorRole,
  locale,
  conversation,
  messages,
  wahaSessionHealth,
  newestMessagesHref,
  olderMessagesHref,
  workflowControls,
}: Readonly<{
  actorRole: FixedRole;
  locale: Locale;
  conversation: PlatformConversationSummary;
  messages: readonly PlatformConversationMessage[];
  wahaSessionHealth: PlatformWahaSessionHealth | null;
  newestMessagesHref: string | null;
  olderMessagesHref: string | null;
  workflowControls?: ReactNode;
}>) {
  const copy = COPY[locale];
  const channelState = wahaSessionHealth
    ? wahaSessionHealth.status === "WORKING"
      ? copy.channelReady
      : copy.channelAttention
    : copy.channelUnknown;

  return (
    <div
      className="space-y-4"
      data-testid="platform-staff-whatsapp-thread"
      data-conversation-id={conversation.id}
    >
      <div className="space-y-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold text-fg">
              {conversation.subject}
            </h2>
            <p className="mt-1 text-sm text-fg-3">
              {copy.updated}: {formatTimestamp(conversation.sortAt, locale)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill tone="info">{queueLabel(locale, conversation.queue)}</Pill>
            <Pill tone="accent">{statusLabel(locale, conversation.status)}</Pill>
          </div>
        </div>
        <dl className="grid gap-3 text-sm text-fg-2 sm:grid-cols-2">
          <Fact label={copy.studentCase}>
            {conversation.studentCaseId ? (
              actorRole === "sales" ? (
                conversation.studentCaseId
              ) : (
                <Link
                  href={`/clients/${conversation.studentCaseId}`}
                  className="inline-flex min-h-11 items-center break-all rounded-ctl px-1 text-accent hover:underline"
                >
                  {conversation.studentCaseId}
                </Link>
              )
            ) : (
              "—"
            )}
          </Fact>
          <Fact label={copy.queue}>{queueLabel(locale, conversation.queue)}</Fact>
          <Fact label={copy.status}>{statusLabel(locale, conversation.status)}</Fact>
          <Fact label={copy.created}>
            {formatTimestamp(conversation.createdAt, locale)}
          </Fact>
          <Fact label={copy.channel}>
            {channelState}
            {wahaSessionHealth ? (
              <span className="block text-xs text-fg-3">
                {copy.channelObserved}: {formatTimestamp(wahaSessionHealth.observedAt, locale)}
              </span>
            ) : null}
          </Fact>
        </dl>
      </div>

      {workflowControls}

      <div>
        <h3 className="text-md font-semibold text-fg">{copy.transcript}</h3>
        <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
          {copy.transcriptDescription}
        </p>
      </div>

      {messages.length === 0 ? (
        <EmptyState text={copy.emptyMessages} />
      ) : (
        <ol className="space-y-3" data-testid="platform-staff-whatsapp-messages">
          {messages.map((message) => {
            const incoming = message.direction === "inbound";
            return (
              <li
                key={message.id}
                className={cn(
                  "rounded-card border px-4 py-3",
                  incoming
                    ? "border-border bg-surface"
                    : "border-accent/20 bg-accent-weak/40",
                )}
                data-testid="platform-staff-whatsapp-message"
                data-message-id={message.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-3">
                    {incoming ? copy.incoming : copy.outgoing}
                  </span>
                  <span className="text-xs text-fg-3">
                    {formatTimestamp(message.createdAt, locale)}
                  </span>
                </div>
                <p className="mt-2 max-w-[56ch] whitespace-pre-wrap text-base leading-6 text-fg">
                  {message.bodyText}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {newestMessagesHref || olderMessagesHref ? (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label={copy.transcript}
        >
          {newestMessagesHref ? (
            <Link
              href={newestMessagesHref}
              className={btnGhostCls}
              data-testid="platform-staff-whatsapp-messages-reset"
            >
              ← {copy.newestMessages}
            </Link>
          ) : (
            <span />
          )}
          {olderMessagesHref ? (
            <Link
              href={olderMessagesHref}
              className={btnGhostCls}
              rel="next"
              data-testid="platform-staff-whatsapp-messages-next"
            >
              {copy.olderMessages} →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function Fact({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-3">
        {label}
      </dt>
      <dd className="mt-1 break-words text-fg">{children}</dd>
    </div>
  );
}

function Pill({
  tone,
  children,
}: Readonly<{ tone: "info" | "accent"; children: ReactNode }>) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-4 whitespace-nowrap",
        tone === "info" ? "bg-info-weak text-info" : "bg-accent-weak text-accent",
      )}
    >
      {children}
    </span>
  );
}

function queueLabel(
  locale: Locale,
  queue: PlatformConversationSummary["queue"],
) {
  return queue === "sales" ? COPY[locale].queueSales : COPY[locale].queueAdmissions;
}

function statusLabel(
  locale: Locale,
  status: PlatformConversationSummary["status"],
) {
  return status === "open" ? COPY[locale].statusOpen : COPY[locale].statusClosed;
}

function formatTimestamp(value: string, locale: Locale) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  const language = locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function conversationHref(
  conversationId: string,
  queueCursor: PlatformConversationCursor | null,
) {
  const path = `/whatsapp/${conversationId}`;
  const query = queueCursorSearchParams(queueCursor);
  return query ? `${path}?${query.toString()}` : path;
}

function queueHref(queueCursor: PlatformConversationCursor | null) {
  const query = queueCursorSearchParams(queueCursor);
  return query ? `/whatsapp?${query.toString()}` : "/whatsapp";
}

function queueCursorSearchParams(queueCursor: PlatformConversationCursor | null) {
  if (!queueCursor) return null;
  return new URLSearchParams({
    before_at: queueCursor.sortAt,
    before_id: queueCursor.id,
  });
}
