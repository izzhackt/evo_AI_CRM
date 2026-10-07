import "server-only";

import type {
  InboxChatModel,
  InboxConversation,
  InboxSelectedConversation,
  InboxView,
} from "@/components/v3/Inbox";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  getPlatformConversationCommandContext,
  getPlatformWahaSessionHealth,
  getPlatformWhatsAppChatState,
  getPlatformWhatsAppThread,
  listPlatformConversations,
  type PlatformConversationCursor,
  type PlatformConversationSummary,
  type PlatformWhatsAppChatAttempt,
  type PlatformWhatsAppChatMessage,
  type PlatformWhatsAppChatState,
} from "@/lib/platform-communications";
import { staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import { isFreshWorkingWahaSession } from "@/lib/provider-display-status";
import { isPlatformWahaIngressEnabled } from "@/lib/server/platform-waha-ingress-config";
import { withLivePlatformWahaHealth } from "@/lib/server/platform-waha-live-health";
import { aiAutosendServerState } from "@/lib/server/ai-agent-send-config";
import { aiAutosendAnswersHere } from "@/lib/v3/ai-agent-autosend";
import { readAiAutosendChat } from "@/lib/v3/ai-agent-autosend-source";
import { buildV3InboxHref } from "@/lib/v3/inbox-href";
import { inboxPresentationQueue, inboxReplyActor } from "@/lib/v3/inbox-access";
import {
  readV3InboxMediaAttachmentContext,
  toV3InboxMessageMedia,
  type V3InboxMediaAttachmentContext,
} from "@/lib/v3/inbox-media";
import { readLeadHandoffStrip } from "@/lib/v3/sales-numbers-source";
import { stagePhase } from "@/lib/v3/stages";
import { salesStage } from "@/lib/v3/wording";
import {
  inboxPulseSignature,
  type InboxChatAttempt,
  type InboxChatMessage,
  type InboxReplyAccess,
} from "@/lib/v3/whatsapp-chat";

const INBOX_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 50;

const BISHKEK_TIME = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Bishkek",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type InboxReadOptions = Readonly<{
  conversationId: string | null;
  queueCursor: PlatformConversationCursor | null;
  query: string | null;
  waitingOnly: boolean;
}>;

export type InboxReadModel = Readonly<{
  view: InboxView;
}>;

function formatInboxTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error("V3 inbox is unavailable.");
  }
  return BISHKEK_TIME.format(parsed).replace(",", "");
}

type InboxChannelStatus = Pick<
  InboxSelectedConversation,
  "channelState" | "channelObservedAt"
>;

async function readInboxChannelStatus(
  actor: ActivePlatformActor,
): Promise<InboxChannelStatus> {
  try {
    // The recorded status only says when the session last changed; the live
    // probe says what it is now, so the banner does not go stale.
    const health = await withLivePlatformWahaHealth(
      actor.organizationId,
      await getPlatformWahaSessionHealth(actor, "crm_primary"),
    );
    // Нет строки о сессии CRM — WhatsApp к CRM не подключали (чтение
    // прошло; сбой чтения — ниже, «unavailable»).
    const channelState: InboxChannelStatus["channelState"] =
      health === null
        ? "not_connected"
        : isFreshWorkingWahaSession(health)
          ? "ready"
          : "attention";
    return Object.freeze({
      // Сессия работает, но приём выключен на сервере: «подключён» было бы
      // неправдой — входящие в CRM не попадают.
      channelState:
        channelState === "ready" && !isPlatformWahaIngressEnabled()
          ? "intake_off"
          : channelState,
      channelObservedAt: health ? formatInboxTime(health.observedAt) : null,
    });
  } catch {
    // Session health is informational. Queue, transcript and command-authority
    // failures retain their existing fail-closed path; the send itself is
    // gated by the database's own readiness check.
    return Object.freeze({ channelState: "unavailable", channelObservedAt: null });
  }
}

function formatWaitingRu(sinceIso: string): string | null {
  const since = new Date(sinceIso);
  if (!Number.isFinite(since.valueOf())) return null;
  const elapsedMs = Date.now() - since.valueOf();
  if (elapsedMs < 0) return null;
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн`;
}

function toInboxConversation(
  summary: PlatformConversationSummary,
  queueCursor: PlatformConversationCursor | null,
  filters: Readonly<{ query: string | null; waitingOnly: boolean }>,
): InboxConversation {
  return Object.freeze({
    id: summary.id,
    person: summary.subject,
    queue: summary.queue,
    status: summary.status,
    updatedAt: formatInboxTime(summary.sortAt),
    waitingSince: summary.waitingSince
      ? formatInboxTime(summary.waitingSince)
      : null,
    awaitingReplyFor: summary.waitingSince
      ? formatWaitingRu(summary.waitingSince)
      : null,
    href: buildV3InboxHref({
      conversationId: summary.id,
      queueCursor,
      filters,
    }),
  });
}

export function toInboxChatMessage(
  message: PlatformWhatsAppChatMessage,
  viewerMembershipId: string,
): InboxChatMessage {
  return Object.freeze({
    id: message.id,
    inbound: message.direction === "inbound",
    body: message.bodyText,
    createdAt: message.createdAt,
    origin: message.origin,
    senderName: message.senderName,
    senderIsViewer: message.senderMembershipId !== null
      && message.senderMembershipId === viewerMembershipId.toLowerCase(),
    ack: message.direction === "outbound" ? message.wahaAckName : null,
    media: Object.freeze(message.media.map(toV3InboxMessageMedia)),
  });
}

function toInboxChatAttempt(
  attempt: PlatformWhatsAppChatAttempt,
  viewerMembershipId: string,
): InboxChatAttempt {
  // Автоответ (P4) подписан ответственным, но это не его сообщение: ни
  // «Повторить» тем же запросом, ни «Вернуть текст в поле».
  const autoreply = attempt.kind === "ai_autosend";
  return Object.freeze({
    autoreply,
    attemptId: attempt.attemptId,
    workItemId: attempt.workItemId,
    requestId: attempt.requestId,
    status: attempt.status,
    reconciliationRequired: attempt.reconciliationRequired,
    text: attempt.finalText,
    authorName: attempt.authorizedByName,
    authorIsViewer: !autoreply && attempt.authorizedByMembershipId === viewerMembershipId.toLowerCase(),
    at: attempt.authorizedAt,
    claimedAt: attempt.claimedAt,
    sourceMessageId: attempt.sourceMessageId,
    failureCode: attempt.failureCode,
    readback: attempt.latestReconciliationOutcome,
    readbackSettled: attempt.readbackSettled,
  });
}

/** Подпись списка для опроса: строки первой страницы, без текста и имён. */
export function inboxListSignature(rows: readonly PlatformConversationSummary[]): string {
  return inboxPulseSignature(rows.flatMap((row) => [row.id, row.sortAt, row.waitingSince, row.lastMessageAt]));
}

/** Подпись открытого чата для опроса: последнее сообщение и состояния отправок. */
export function inboxChatSignature(state: PlatformWhatsAppChatState): string {
  return inboxPulseSignature([
    state.newestMessageId,
    state.newestMessageAt,
    state.latestInboundMessageId,
    ...state.attempts.flatMap((attempt) => [
      attempt.workItemId,
      attempt.status,
      attempt.latestReconciliationOutcome,
      attempt.lastReconciledAt,
      attempt.readbackSettled ? "settled" : null,
    ]),
  ]);
}

function replyAccessOf(
  actor: ActivePlatformActor,
  conversation: PlatformConversationSummary,
  state: PlatformWhatsAppChatState,
  channelState: InboxSelectedConversation["channelState"],
): InboxReplyAccess {
  const who = inboxReplyActor(actor);
  if (who !== "allowed") return who;
  if (conversation.wahaSessionName !== "crm_primary") return "old_session";
  if (conversation.status !== "open") return "closed";
  if (state.latestInboundMessageId === null) return "no_client_message";
  if (channelState === "not_connected") return "not_connected";
  return channelState === "attention" ? "attention" : "allowed";
}

/** Этап лида словами доски для шапки чата; без права или без чтения — ничего. */
async function readStage(
  actor: ActivePlatformActor,
  leadId: string | null,
): Promise<InboxChatModel["stage"]> {
  if (leadId === null || !staffPresentationCan(actor, "sales.read")) return null;
  const read = await readLeadHandoffStrip(actor, leadId);
  if (read.status !== "available") return null;
  const stage = read.strip.stage;
  if (stage === "closed") return Object.freeze({ label: "Лид закрыт", phase: null });
  const label = salesStage(stage);
  return label ? Object.freeze({ label, phase: stagePhase("sales", stage) }) : null;
}

/**
 * Шапка чата «Ночью отвечает автоответчик» (P4): только если автоответчик
 * здесь ответит по-настоящему — включён, не на паузе, чат не исключён, режим
 * «Отвечает» или чат живого теста, отправка включена на сервере. Чтение
 * информационное: сбой или отказ — без чипа, чат работает как прежде.
 */
async function readAutoreplyAtNight(actor: ActivePlatformActor, conversationId: string): Promise<boolean> {
  if (!staffHasPermission(actor, "ai.agent.use")) return false;
  try {
    const read = await readAiAutosendChat(actor, conversationId);
    return read.status === "available" && aiAutosendAnswersHere(read.data, aiAutosendServerState() === "on");
  } catch {
    return false;
  }
}

/**
 * One bounded canonical Inbox view. The queue and the selected chat keep
 * their independent reads; transcripts are never preloaded for queue rows.
 * The selected chat is resolved again through the authenticated conversation
 * reader before its canonical EVO identity is exposed, and its reply source
 * is always the latest customer message from the chat state (266), whatever
 * page of the transcript is shown.
 */
export async function readInbox(
  actor: ActivePlatformActor,
  options: InboxReadOptions,
): Promise<InboxReadModel> {
  const presentationQueue = inboxPresentationQueue(actor);
  const filters = Object.freeze({
    query: options.query,
    waitingOnly: options.waitingOnly,
  });
  const readAt = new Date().toISOString();
  const [queue, resolvedThread] = await Promise.all([
    listPlatformConversations(actor, {
      cursor: options.queueCursor,
      pageSize: INBOX_PAGE_SIZE,
      query: options.query ?? undefined,
      waitingOnly: options.waitingOnly,
      ...(presentationQueue ? { queue: presentationQueue } : {}),
    }),
    options.conversationId
      ? getPlatformWhatsAppThread(actor, options.conversationId, {
          pageSize: MESSAGE_PAGE_SIZE,
        })
      : Promise.resolve(null),
  ]);
  const thread =
    resolvedThread &&
    (presentationQueue === undefined ||
      resolvedThread.conversation.queue === presentationQueue)
      ? resolvedThread
      : null;

  let selected: InboxSelectedConversation | null = null;
  const channelStatusPromise =
    !thread || thread.conversation.wahaSessionName === "crm_primary"
      ? readInboxChannelStatus(actor)
      : Promise.resolve<InboxChannelStatus>({
          channelState: "unknown",
          channelObservedAt: null,
        });
  if (thread) {
    const [context, channelStatus, state] = await Promise.all([
      getPlatformConversationCommandContext(actor, thread.conversation.id),
      channelStatusPromise,
      getPlatformWhatsAppChatState(actor, thread.conversation.id),
    ]);
    if (
      context === null
      || context.conversationId !== thread.conversation.id
      || context.studentCaseId !== thread.conversation.studentCaseId
    ) {
      throw new Error("V3 inbox is unavailable.");
    }
    const [stage, autoreplyAtNight] = await Promise.all([
      readStage(actor, context.canonicalLeadId),
      readAutoreplyAtNight(actor, thread.conversation.id),
    ]);
    const chat: InboxChatModel = Object.freeze({
      messages: Object.freeze(thread.messages.map((message) => toInboxChatMessage(message, actor.membershipId))),
      hasOlder: thread.nextMessageCursor !== null,
      attempts: Object.freeze(state.attempts.map((attempt) => toInboxChatAttempt(attempt, actor.membershipId))),
      latestInboundMessageId: state.latestInboundMessageId,
      replyAccess: replyAccessOf(actor, thread.conversation, state, channelStatus.channelState),
      stage,
      autoreplyAtNight,
      readAt,
      pulse: inboxChatSignature(state),
    });

    selected = Object.freeze({
      ...toInboxConversation(thread.conversation, options.queueCursor, filters),
      channelState: channelStatus.channelState,
      channelObservedAt: channelStatus.channelObservedAt,
      canonicalContext: Object.freeze({
        leadId: context.canonicalLeadId,
        clientId: context.canonicalClientId,
        studentCaseId: thread.conversation.studentCaseId,
      }),
      chat,
    });
  }

  const channelStatus = await channelStatusPromise;
  return Object.freeze({
    view: Object.freeze({
      ...channelStatus,
      conversations: Object.freeze(
        queue.rows.map((summary) =>
          toInboxConversation(summary, options.queueCursor, filters),
        ),
      ),
      selected,
      searchQuery: options.query,
      waitingOnly: options.waitingOnly,
      waitingToggleHref: buildV3InboxHref({
        filters: Object.freeze({
          query: options.query,
          waitingOnly: !options.waitingOnly,
        }),
      }),
      queueCurrentHref: buildV3InboxHref({
        queueCursor: options.queueCursor,
        filters,
      }),
      queueNewestHref: options.queueCursor
        ? buildV3InboxHref({ filters })
        : null,
      queueOlderHref: queue.nextCursor
        ? buildV3InboxHref({ queueCursor: queue.nextCursor, filters })
        : null,
      // The list is watched only on its newest page: an older page stays put.
      listPulse: options.queueCursor ? null : inboxListSignature(queue.rows),
    }),
  });
}

export type InboxOlderMessagesPage = Readonly<{
  messages: readonly InboxChatMessage[];
  hasOlder: boolean;
  /**
   * «В дело студента» for this page's attachments: the same reader as the
   * page's newest messages (role, active case, open slots), with request ids
   * for exactly these media. null — nothing on this page can be attached.
   */
  attachmentContext: V3InboxMediaAttachmentContext | null;
}>;

/**
 * «Показать ранее»: one older page of the selected chat, through the same
 * guards and queue filter as the page. null — the chat is not readable.
 */
export async function readInboxOlderMessages(
  actor: ActivePlatformActor,
  conversationId: string,
  cursor: PlatformConversationCursor,
): Promise<InboxOlderMessagesPage | null> {
  const presentationQueue = inboxPresentationQueue(actor);
  const thread = await getPlatformWhatsAppThread(actor, conversationId, { cursor, pageSize: MESSAGE_PAGE_SIZE });
  if (!thread || (presentationQueue !== undefined && thread.conversation.queue !== presentationQueue)) return null;
  const messages = Object.freeze(thread.messages.map((message) => toInboxChatMessage(message, actor.membershipId)));
  const attachmentContext = await readV3InboxMediaAttachmentContext(actor, {
    conversationId: thread.conversation.id,
    studentCaseId: thread.conversation.studentCaseId,
    media: messages.flatMap((message) => message.media),
  });
  return Object.freeze({
    messages,
    hasOlder: thread.nextMessageCursor !== null,
    attachmentContext,
  });
}

/**
 * The pulse of the open page: signatures of the list's newest page and of the
 * open chat — no text, no names. The browser compares them with what it shows
 * and refreshes the page only when one changed.
 */
export async function readInboxPulse(
  actor: ActivePlatformActor,
  options: Readonly<{ conversationId: string | null; query: string | null; waitingOnly: boolean; list: boolean }>,
): Promise<Readonly<{ list: string | null; chat: string | null }> | null> {
  const presentationQueue = inboxPresentationQueue(actor);
  const [queue, thread] = await Promise.all([
    options.list
      ? listPlatformConversations(actor, {
          pageSize: INBOX_PAGE_SIZE,
          query: options.query ?? undefined,
          waitingOnly: options.waitingOnly,
          ...(presentationQueue ? { queue: presentationQueue } : {}),
        })
      : Promise.resolve(null),
    options.conversationId
      ? getPlatformWhatsAppChatState(actor, options.conversationId)
      : Promise.resolve(null),
  ]);
  return Object.freeze({
    list: queue ? inboxListSignature(queue.rows) : null,
    chat: thread ? inboxChatSignature(thread) : null,
  });
}
