import { notFound, redirect } from "next/navigation";

import { Inbox, inboxNotConnected } from "@/components/v3/Inbox";
import { PartShell } from "@/components/v3/PartShell";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import {
  parsePlatformConversationCursor,
  parsePlatformRouteUuid,
  type PlatformConversationCursor,
} from "@/lib/platform-communications";
import { requireV3PageActor } from "@/lib/platform-guards";
import { buildV3InboxHref } from "@/lib/v3/inbox-href";
import { v3InboxProfileHref } from "@/lib/v3/inbox-profile-link";
import { readV3InboxMediaAttachmentContext } from "@/lib/v3/inbox-media";
import { readInbox } from "@/lib/v3/inbox-source";
import { readV3ReplySnippets } from "@/lib/v3/reply-snippets-source";
import { aiAgentFeatureOn } from "@/lib/server/ai-agent-internal-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp" };

type SearchParams = Readonly<{
  q?: string | string[];
  waiting?: string | string[];
  conversation?: string | string[];
  before_at?: string | string[];
  before_id?: string | string[];
  messages_before_at?: string | string[];
  messages_before_id?: string | string[];
}>;

/**
 * «Продажи → WhatsApp» (решение владельца 06.10.2026): полноценный чат вместо
 * блока «Ответ и отправка». Подтверждения одной отправки и панели
 * синхронизации с внешней CRM на этой странице нет; окно ИИ «Помочь с
 * ответом» (план ИИ-агента §12.1) — у того, у кого есть ai.agent.use, кроме
 * просмотра роли: оно готовит черновик, отправляет сотрудник из поля внизу чата.
 */
export default async function InboxPart({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [query, actor] = await Promise.all([
    searchParams,
    requireV3PageActor("/v3/inbox"),
  ]);
  assertExpectedQueryKeys(query);
  const conversationId = parseConversationId(query.conversation);
  const inboxQuery = parseInboxQuery(query.q);
  const waitingOnly = parseWaitingOnly(query.waiting);
  const queueCursor = parseCursor(query.before_at, query.before_id);
  const messageCursor = parseCursor(
    query.messages_before_at,
    query.messages_before_id,
  );
  if (conversationId === null && messageCursor !== null) notFound();
  // Ранние сообщения подгружаются в самой ленте («Показать ранее»); прежние
  // ссылки на страницу сообщений открывают чат с последних сообщений.
  if (conversationId !== null && messageCursor !== null) {
    redirect(buildV3InboxHref({
      conversationId,
      queueCursor,
      filters: { query: inboxQuery, waitingOnly },
    }));
  }

  const { view } = await readInbox(actor, {
    conversationId,
    queueCursor,
    query: inboxQuery,
    waitingOnly,
  });
  if (conversationId !== null && view.selected === null) notFound();

  let profileHref: string | null = null;
  let profileLabel = "Открыть профиль";
  let replySnippets: Awaited<ReturnType<typeof readSnippets>> = null;
  let mediaAttachmentContext: Awaited<
    ReturnType<typeof readV3InboxMediaAttachmentContext>
  > = null;
  if (view.selected) {
    const selected = view.selected;
    const canReply = selected.chat.replyAccess === "allowed" || selected.chat.replyAccess === "attention";
    [replySnippets, mediaAttachmentContext] = await Promise.all([
      canReply ? readSnippets(actor) : Promise.resolve(null),
      readV3InboxMediaAttachmentContext(actor, {
        conversationId: selected.id,
        studentCaseId: selected.canonicalContext.studentCaseId,
        media: selected.chat.messages.flatMap((message) => message.media),
      }),
    ]);
    profileHref = v3InboxProfileHref(actor, selected.canonicalContext);
    profileLabel = profileHref?.startsWith("/v3/profile?case=") ? "Открыть дело" : "Карточка лида";
  }

  // Окно ИИ: право — подсказка меню; доступ к диалогу, согласие и лимиты решает
  // база по каждому запросу. Без секрета агента окно говорит «не подключён».
  const assistant = !isStaffPreview(actor) && staffHasPermission(actor, "ai.agent.use")
    ? { featureOn: aiAgentFeatureOn() }
    : null;

  // Не подключён и пусто: считать нечего, числа в заголовке нет. Подключает
  // Администратор — только ему ссылка на Настройки (не в просмотре роли).
  const notConnected = inboxNotConnected(view);
  const settingsHref = actor.systemRole === "admin" && actor.presentationRole === null
    ? "/v3/settings?section=integrations"
    : null;

  // WhatsApp — пункт «Продаж» (решение владельца 27.09.2026: WhatsApp
  // продажников, куда приходят лиды); страница стоит отдельно от «Переписки»
  // поступления, число диалогов — у заголовка, как до Э5.
  return (
    <PartShell title="WhatsApp" count={notConnected ? null : view.conversations.length} fill>
      <Inbox
        view={view}
        profileHref={profileHref}
        profileLabel={profileLabel}
        settingsHref={settingsHref}
        storageScope={`${actor.organizationId}:${actor.membershipId}`}
        replySnippets={replySnippets}
        mediaAttachmentContext={mediaAttachmentContext}
        assistant={assistant}
      />
    </PartShell>
  );
}

/** Шаблоны ответа — только тому, кто может ответить и читает шаблоны. */
async function readSnippets(actor: Awaited<ReturnType<typeof requireV3PageActor>>) {
  if (!staffPresentationCan(actor, "messaging.send")) return null;
  const snippets = await readV3ReplySnippets(actor);
  return snippets.map(({ replySnippetId, title, body }) => ({ replySnippetId, title, body }));
}

function assertExpectedQueryKeys(params: SearchParams): void {
  const allowed = new Set([
    "q",
    "waiting",
    "conversation",
    "before_at",
    "before_id",
    "messages_before_at",
    "messages_before_id",
  ]);
  if (Object.keys(params).some((key) => !allowed.has(key))) notFound();
}

function parseInboxQuery(raw: string | string[] | undefined): string | null {
  const value = singleValue(raw);
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length > 200) notFound();
  return normalized || null;
}

function parseWaitingOnly(raw: string | string[] | undefined): boolean {
  const value = singleValue(raw);
  if (value === undefined) return false;
  if (value !== "1") notFound();
  return true;
}

function parseConversationId(raw: string | string[] | undefined): string | null {
  const value = singleValue(raw);
  if (value === undefined) return null;
  const conversationId = parsePlatformRouteUuid(value);
  if (conversationId === null) notFound();
  return conversationId;
}

function parseCursor(
  rawSortAt: string | string[] | undefined,
  rawId: string | string[] | undefined,
): PlatformConversationCursor | null {
  const sortAt = singleValue(rawSortAt);
  const id = singleValue(rawId);
  if (sortAt === undefined && id === undefined) return null;
  if (sortAt === undefined || id === undefined) notFound();
  const cursor = parsePlatformConversationCursor(sortAt, id);
  if (cursor === null) notFound();
  return cursor;
}

function singleValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) notFound();
  return value;
}
