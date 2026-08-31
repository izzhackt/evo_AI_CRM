import Link from "next/link";
import type { ReactNode } from "react";

import { formatCanonicalTimestamp } from "@/components/platform/core/CanonicalRecordsPresentation";
import { CanonicalGeminiProposalPanel } from "@/components/platform/communications/CanonicalGeminiProposalPanel";
import { CanonicalWhatsAppOutboundComposer } from "@/components/platform/communications/CanonicalWhatsAppOutboundComposer";
import { EmptyState, PageHeader, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { CanonicalGeminiProposalAvailability } from "@/lib/server/canonical-gemini-proposal-config";
import type { CanonicalWahaProviderAvailability } from "@/lib/server/canonical-waha-provider";
import type {
  CanonicalConversationMessage,
  CanonicalGeminiProposalSnapshot,
  CanonicalReadCursor,
  CanonicalStaffConversationQueueRow,
  CanonicalWhatsAppSendAttemptSnapshot,
} from "@/lib/server/canonical-crm-repository";

const COPY = {
  ru: {
    title: "WhatsApp · Inbox",
    description:
      "Staff-очередь, Gemini-черновики и подтверждённая человеком отправка работают через одну каноническую базу EVO PostgreSQL.",
    queueTitle: "Диалоги",
    queueDescription:
      "Sales видит свои диалоги до handoff, Admissions видит переданные диалоги, Admin видит объединение без запасного источника.",
    emptyQueue: "Сохранённых диалогов пока нет.",
    emptyThreadTitle: "Выберите диалог",
    emptyThreadText:
      "Откройте запись из очереди слева. Это единственная staff-очередь WhatsApp в текущем V2 runtime.",
    openConversation: "Открыть диалог",
    updated: "Обновлено",
    lead: "Лид",
    studentCase: "Student Case",
    stage: "Этап",
    owner: "Ответственность",
    phone: "Телефон",
    email: "Email",
    newestQueue: "К новым диалогам",
    olderQueue: "Более старые диалоги",
    backToQueue: "К списку диалогов",
    newestMessages: "К новым сообщениям",
    olderMessages: "Более старые сообщения",
    transcript: "Переписка WhatsApp",
    transcriptDescription:
      "Сообщения показаны от новых к старым. Отправка доступна только через форму с явным подтверждением; автономного или запасного отправителя нет.",
    emptyMessages: "В этой переписке пока нет сообщений.",
    incoming: "Входящее",
    outgoing: "Исходящее · история",
    roleSales: "Sales",
    roleAdmissions: "Admissions",
    roleAdmin: "Admin",
    stage_new: "Новый",
    stage_qualifying: "Квалификация",
    stage_qualified: "Квалифицирован",
    stage_disqualified: "Дисквалифицирован",
    stage_handoff_ready: "Готов к передаче",
    stage_handed_off: "Передан",
  },
  ky: {
    title: "WhatsApp · Inbox",
    description:
      "Staff кезеги, Gemini долбоорлору жана адам ырастаган жөнөтүү бир EVO PostgreSQL булагы аркылуу иштейт.",
    queueTitle: "Диалогдор",
    queueDescription:
      "Sales handoff'ко чейин өз диалогдорун көрөт, Admissions өткөрүлгөн диалогдорду көрөт, Admin запассыз бириктирилген көрүнүштү көрөт.",
    emptyQueue: "Сакталган диалогдор азырынча жок.",
    emptyThreadTitle: "Диалог тандаңыз",
    emptyThreadText:
      "Сол жактагы кезектен жазууну ачыңыз. Бул учурдагы V2 runtime'дагы жалгыз staff WhatsApp кезеги.",
    openConversation: "Диалогду ачуу",
    updated: "Жаңыртылды",
    lead: "Лид",
    studentCase: "Student Case",
    stage: "Этап",
    owner: "Жооптуу",
    phone: "Телефон",
    email: "Email",
    newestQueue: "Жаңы диалогдорго",
    olderQueue: "Эски диалогдор",
    backToQueue: "Диалогдор тизмесине",
    newestMessages: "Жаңы билдирүүлөргө",
    olderMessages: "Эски билдирүүлөр",
    transcript: "WhatsApp кат алышуусу",
    transcriptDescription:
      "Билдирүүлөр жаңысынан эскисине көрсөтүлөт. Жөнөтүү ачык ырастоо формасы аркылуу гана; автономдуу же запас жөнөтүүчү жок.",
    emptyMessages: "Бул кат алышууда билдирүүлөр азырынча жок.",
    incoming: "Кирген",
    outgoing: "Чыккан · тарых",
    roleSales: "Sales",
    roleAdmissions: "Admissions",
    roleAdmin: "Admin",
    stage_new: "Жаңы",
    stage_qualifying: "Квалификация",
    stage_qualified: "Квалификацияланган",
    stage_disqualified: "Четтетилген",
    stage_handoff_ready: "Өткөрүүгө даяр",
    stage_handed_off: "Өткөрүлгөн",
  },
  en: {
    title: "WhatsApp · Inbox",
    description:
      "The staff queue, Gemini drafts and human-confirmed sending use one canonical EVO PostgreSQL authority.",
    queueTitle: "Conversations",
    queueDescription:
      "Sales sees its conversations before handoff, Admissions sees handed-off conversations, and Admin sees the combined staff queue.",
    emptyQueue: "There are no persisted conversations yet.",
    emptyThreadTitle: "Select a conversation",
    emptyThreadText:
      "Open an entry from the queue on the left. This is the only staff WhatsApp queue in the current V2 runtime.",
    openConversation: "Open conversation",
    updated: "Updated",
    lead: "Lead",
    studentCase: "Student Case",
    stage: "Stage",
    owner: "Owner",
    phone: "Phone",
    email: "Email",
    newestQueue: "Newest conversations",
    olderQueue: "Older conversations",
    backToQueue: "Back to conversations",
    newestMessages: "Newest messages",
    olderMessages: "Older messages",
    transcript: "WhatsApp transcript",
    transcriptDescription:
      "Messages are newest first. A staff member must verify the recipient and final text before each send; autonomous sending is disabled.",
    emptyMessages: "There are no messages in this conversation yet.",
    incoming: "Incoming",
    outgoing: "Outgoing · history",
    roleSales: "Sales",
    roleAdmissions: "Admissions",
    roleAdmin: "Admin",
    stage_new: "New",
    stage_qualifying: "Qualifying",
    stage_qualified: "Qualified",
    stage_disqualified: "Disqualified",
    stage_handoff_ready: "Handoff ready",
    stage_handed_off: "Handed off",
  },
} as const;

type WorkspaceProps = Readonly<{
  locale: Locale;
  actorRole: FixedRole;
  conversations: readonly CanonicalStaffConversationQueueRow[];
  queueCursor: CanonicalReadCursor | null;
  queueResetHref: string | null;
  queueNextHref: string | null;
  selectedConversationId?: string | null;
  thread?: {
    conversation: CanonicalStaffConversationQueueRow;
    messages: readonly CanonicalConversationMessage[];
    geminiAvailability: CanonicalGeminiProposalAvailability;
    geminiProposal: CanonicalGeminiProposalSnapshot | null;
    geminiReviewRequestId: string | null;
    wahaAvailability: CanonicalWahaProviderAvailability;
    latestSendAttempt: CanonicalWhatsAppSendAttemptSnapshot | null;
    sendRequestId: string;
    reconcileRequestId: string;
    newestMessagesHref: string | null;
    olderMessagesHref: string | null;
  } | null;
}>;

export function CanonicalStaffWhatsAppWorkspace({
  locale,
  actorRole,
  conversations,
  queueCursor,
  queueResetHref,
  queueNextHref,
  selectedConversationId = null,
  thread = null,
}: WorkspaceProps) {
  const copy = COPY[locale];
  const mobileBackHref = queueHref(queueCursor);

  return (
    <div className="space-y-4" data-testid="canonical-staff-whatsapp-page">
      <PageHeader title={copy.title} description={copy.description} />
      <div className="flex h-[calc(100vh-220px)] min-h-[520px] flex-col overflow-hidden rounded-card border border-border bg-surface shadow-evo lg:flex-row">
        <aside
          className={cn(
            "w-full shrink-0 border-b border-border bg-surface-2 lg:block lg:w-[360px] lg:border-r lg:border-b-0",
            thread && "hidden",
          )}
        >
          <div className="border-b border-border px-4 py-4">
            <h2 className="text-[14px] font-semibold text-fg">{copy.queueTitle}</h2>
            <p className="mt-1 text-[12.5px] leading-5 text-fg-3">
              {copy.queueDescription}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-[12px]">
            {queueResetHref ? (
              <Link
                href={queueResetHref}
                className={btnGhostCls}
                data-testid="canonical-staff-whatsapp-queue-reset"
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
                data-testid="canonical-staff-whatsapp-queue-next"
              >
                {copy.olderQueue} →
              </Link>
            ) : null}
          </div>
          <nav
            className="max-h-[320px] overflow-y-auto lg:max-h-full"
            aria-label={copy.queueTitle}
            data-testid="canonical-staff-whatsapp-queue"
          >
            {conversations.length === 0 ? (
              <EmptyState text={copy.emptyQueue} />
            ) : (
              <ol className="divide-y divide-border">
                {conversations.map((conversation) => {
                  const active = conversation.conversationId === selectedConversationId;
                  const href = conversationHref(conversation.conversationId, queueCursor);
                  return (
                    <li
                      key={conversation.conversationId}
                      data-testid="canonical-staff-whatsapp-row"
                      data-conversation-id={conversation.conversationId}
                    >
                      <Link
                        href={href}
                        aria-label={`${copy.openConversation}: ${conversation.displayName}`}
                        className={cn(
                          "block px-4 py-3 transition-colors hover:bg-surface",
                          active && "bg-accent-weak",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-semibold text-fg">
                              {conversation.displayName}
                            </p>
                            <p className="truncate text-[12px] text-fg-3">
                              {conversation.phone ?? conversation.email ?? conversation.conversationId}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-fg-3">
                            {formatCanonicalTimestamp(conversation.updatedAt, locale)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Pill tone="info">
                            {stageLabel(locale, conversation.leadStage)}
                          </Pill>
                          <Pill tone="accent">
                            {roleLabel(locale, conversation.owningRole)}
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
        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {thread ? (
            <>
              <Link
                href={mobileBackHref}
                className={cn(btnGhostCls, "mb-3 inline-flex lg:hidden")}
                data-testid="canonical-staff-whatsapp-mobile-back"
              >
                ← {copy.backToQueue}
              </Link>
              <ConversationThread
                actorRole={actorRole}
                locale={locale}
                conversation={thread.conversation}
                messages={thread.messages}
                geminiAvailability={thread.geminiAvailability}
                geminiProposal={thread.geminiProposal}
                geminiReviewRequestId={thread.geminiReviewRequestId}
                wahaAvailability={thread.wahaAvailability}
                latestSendAttempt={thread.latestSendAttempt}
                sendRequestId={thread.sendRequestId}
                reconcileRequestId={thread.reconcileRequestId}
                newestMessagesHref={thread.newestMessagesHref}
                olderMessagesHref={thread.olderMessagesHref}
              />
            </>
          ) : (
            <div
              className="flex h-full flex-col items-center justify-center px-6 text-center"
              data-testid="canonical-staff-whatsapp-empty"
            >
              <h2 className="text-[16px] font-semibold text-fg">
                {copy.emptyThreadTitle}
              </h2>
              <p className="mt-2 max-w-lg text-[13px] leading-6 text-fg-3">
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
  geminiAvailability,
  geminiProposal,
  geminiReviewRequestId,
  wahaAvailability,
  latestSendAttempt,
  sendRequestId,
  reconcileRequestId,
  newestMessagesHref,
  olderMessagesHref,
}: Readonly<{
  actorRole: FixedRole;
  locale: Locale;
  conversation: CanonicalStaffConversationQueueRow;
  messages: readonly CanonicalConversationMessage[];
  geminiAvailability: CanonicalGeminiProposalAvailability;
  geminiProposal: CanonicalGeminiProposalSnapshot | null;
  geminiReviewRequestId: string | null;
  wahaAvailability: CanonicalWahaProviderAvailability;
  latestSendAttempt: CanonicalWhatsAppSendAttemptSnapshot | null;
  sendRequestId: string;
  reconcileRequestId: string;
  newestMessagesHref: string | null;
  olderMessagesHref: string | null;
}>) {
  const copy = COPY[locale];
  return (
    <div
      className="space-y-4"
      data-testid="canonical-staff-whatsapp-thread"
      data-conversation-id={conversation.conversationId}
    >
      <div className="space-y-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-bold text-fg">
              {conversation.displayName}
            </h2>
            <p className="mt-1 text-[13px] text-fg-3">
              {copy.updated}: {formatCanonicalTimestamp(conversation.updatedAt, locale)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill tone="info">{stageLabel(locale, conversation.leadStage)}</Pill>
            <Pill tone="accent">
              {roleLabel(locale, conversation.owningRole)}
            </Pill>
          </div>
        </div>
        <dl className="grid gap-3 text-[13px] text-fg-2 sm:grid-cols-2">
          <Fact label={copy.lead}>
            {actorRole === "admissions" ? (
              conversation.leadId
            ) : (
              <Link
                href={`/sales/${conversation.leadId}`}
                className="inline-flex min-h-11 items-center break-all rounded-ctl px-1 text-accent hover:underline"
              >
                {conversation.leadId}
              </Link>
            )}
          </Fact>
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
          <Fact label={copy.stage}>{stageLabel(locale, conversation.leadStage)}</Fact>
          <Fact label={copy.owner}>{roleLabel(locale, conversation.owningRole)}</Fact>
          <Fact label={copy.phone}>{conversation.phone ?? "—"}</Fact>
          <Fact label={copy.email}>{conversation.email ?? "—"}</Fact>
        </dl>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-fg">{copy.transcript}</h3>
        <p className="mt-1 text-[13px] leading-6 text-fg-3">
          {copy.transcriptDescription}
        </p>
      </div>

      <CanonicalGeminiProposalPanel
        locale={locale}
        conversationId={conversation.conversationId}
        availability={geminiAvailability}
        proposal={geminiProposal}
        reviewRequestId={geminiReviewRequestId}
      />

      <CanonicalWhatsAppOutboundComposer
        key={
          geminiProposal &&
          (geminiProposal.reviewDecision === "accepted" ||
            geminiProposal.reviewDecision === "edited")
            ? geminiProposal.proposalId
            : "staff-authored"
        }
        locale={locale}
        conversationId={conversation.conversationId}
        recipientChatId={conversation.externalConversationId}
        availability={wahaAvailability}
        latestAttempt={latestSendAttempt}
        sendRequestId={sendRequestId}
        reconcileRequestId={reconcileRequestId}
        suggestedText={
          geminiProposal &&
          (geminiProposal.reviewDecision === "accepted" ||
            geminiProposal.reviewDecision === "edited") &&
          geminiProposal.reviewedText
            ? geminiProposal.reviewedText
            : ""
        }
        sourceProposalId={
          geminiProposal &&
          (geminiProposal.reviewDecision === "accepted" ||
            geminiProposal.reviewDecision === "edited") &&
          geminiProposal.reviewedText
            ? geminiProposal.proposalId
            : null
        }
      />

      {messages.length === 0 ? (
        <EmptyState text={copy.emptyMessages} />
      ) : (
        <ol className="space-y-3" data-testid="canonical-staff-whatsapp-messages">
          {messages.map((message) => {
            const incoming = message.direction === "inbound";
            return (
              <li
                key={message.messageId}
                className={cn(
                  "rounded-card border px-4 py-3",
                  incoming
                    ? "border-border bg-surface"
                    : "border-accent/20 bg-accent-weak/40",
                )}
                data-testid="canonical-staff-whatsapp-message"
                data-message-id={message.messageId}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">
                    {incoming ? copy.incoming : copy.outgoing}
                  </span>
                  <span className="text-[11px] text-fg-3">
                    {formatCanonicalTimestamp(message.occurredAt, locale)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-fg">
                  {message.body}
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
              data-testid="canonical-staff-whatsapp-messages-reset"
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
              data-testid="canonical-staff-whatsapp-messages-next"
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
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">
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
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold leading-4 whitespace-nowrap",
        tone === "info" ? "bg-info-weak text-info" : "bg-accent-weak text-accent",
      )}
    >
      {children}
    </span>
  );
}

function roleLabel(locale: Locale, role: "sales" | "admissions" | "admin") {
  const copy = COPY[locale];
  if (role === "sales") return copy.roleSales;
  if (role === "admissions") return copy.roleAdmissions;
  return copy.roleAdmin;
}

function stageLabel(locale: Locale, stage: string) {
  const copy = COPY[locale];
  switch (stage) {
    case "new":
      return copy.stage_new;
    case "qualifying":
      return copy.stage_qualifying;
    case "qualified":
      return copy.stage_qualified;
    case "disqualified":
      return copy.stage_disqualified;
    case "handoff_ready":
      return copy.stage_handoff_ready;
    case "handed_off":
      return copy.stage_handed_off;
    default:
      return stage;
  }
}

function conversationHref(
  conversationId: string,
  queueCursor: CanonicalReadCursor | null,
) {
  const path = `/whatsapp/${conversationId}`;
  const query = queueCursorSearchParams(queueCursor);
  if (!query) return path;
  return `${path}?${query.toString()}`;
}

function queueHref(queueCursor: CanonicalReadCursor | null) {
  const query = queueCursorSearchParams(queueCursor);
  if (!query) return "/whatsapp";
  return `/whatsapp?${query.toString()}`;
}

function queueCursorSearchParams(queueCursor: CanonicalReadCursor | null) {
  if (!queueCursor) return null;
  const query = new URLSearchParams({
    before_at: queueCursor.updatedAt,
    before_id: queueCursor.id,
  });
  return query;
}
