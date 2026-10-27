import Link from "next/link";
import { ArrowLeftIcon, UserRoundIcon } from "lucide-react";

import { StatusBadge } from "@/components/kit/StatusBadge";
import { Button } from "@/components/ui/button";
import { StageChip } from "@/components/v3/blocks/StatusChip";
import { ChatHeaderLink } from "@/components/v3/chats-next/ChatHeaderLink";
import { ContactPhone, channelWarning, spokenPhone, type InboxView } from "@/components/v3/Inbox";
import type { InboxAssistantConfig } from "@/components/v3/inbox/InboxAiAssistant";
import { InboxChat } from "@/components/v3/inbox/InboxChat";
import type { ReplySnippetPickerItem } from "@/components/v3/reply-snippets/ReplySnippetPicker";
import { DialButton } from "@/components/v3/telephony/DialButton";
import type { V3InboxMediaAttachmentContext } from "@/lib/v3/inbox-media";
import type { DialOptions } from "@/lib/v3/telephony-dial";

export type InboxNextThreadProps = Readonly<{
  view: InboxView;
  profileHref: string | null;
  profileLabel: string;
  storageScope: string;
  replySnippets: readonly ReplySnippetPickerItem[] | null;
  mediaAttachmentContext: V3InboxMediaAttachmentContext | null;
  assistant: InboxAssistantConfig | null;
  dial: DialOptions | null;
}>;

/**
 * Открытый диалог: тонкая шапка (имя, этап доски, «Ждёт ответа», «Ночью отвечает автоответчик», номер, беда канала на
 * виду, «Позвонить», «Карточка лида» / «Открыть дело») и прежний движок чата `InboxChat` без изменений: лента, опрос,
 * черновики, ворота отправки и строка «Только чтение» (Wazzup, `receive_only`) — его. Своего поля ответа и вызова
 * отправки у шапки нет.
 */
export function InboxNextThread({ view, profileHref, profileLabel, storageScope, replySnippets, mediaAttachmentContext, assistant, dial }: InboxNextThreadProps) {
  const open = view.selected;
  if (!open) return null;
  const warning = channelWarning(open.channelState);
  const spokenTitle = `${open.person}${open.phone ? `, ${spokenPhone(open.phone)}` : ""}`;
  return (
    <section
      aria-label={`Переписка: ${spokenTitle}`}
      className="v3-inbox-thread flex min-h-0 min-w-0 flex-col"
      data-testid="v3-inbox-thread"
      data-conversation-id={open.id}
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2.5 @2xl:px-4">
        <Button variant="ghost" size="icon" asChild className="-ms-1 text-fg-2 @4xl:hidden">
          <Link href={view.queueCurrentHref} aria-label="Назад к списку диалогов"><ArrowLeftIcon aria-hidden="true" /></Link>
        </Button>
        <div className="min-w-0 flex-1 pt-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="t-section min-w-0 basis-full break-words text-fg @max-2xl:line-clamp-2 @2xl:basis-auto" title={open.person}>{open.person}</h2>
            {open.chat.stage ? <StageChip label={open.chat.stage.label} phase={open.chat.stage.phase} /> : null}
            {open.chat.autoreplyAtNight ? (
              <span className="contents" data-testid="v3-inbox-autoreply-chip">
                <StatusBadge label="Ночью отвечает автоответчик" />
              </span>
            ) : null}
            {open.waitingSince ? <StatusBadge tone="warn" label={`Ждёт ответа${open.awaitingReplyFor ? ` · ${open.awaitingReplyFor}` : ""}`} /> : null}
          </div>
          {open.phone ? <ContactPhone phone={open.phone} className="mt-0.5 block t-meta tabular-nums text-fg-2" /> : null}
          {warning ? <p className="mt-0.5 t-meta text-warn" role="status" data-testid="v3-inbox-thread-channel">{warning}</p> : null}
        </div>
        {dial?.status === "ready" && open.canonicalContext.leadId ? (
          <DialButton leadId={open.canonicalContext.leadId} mapped={dial.mapped} subject={open.person} />
        ) : null}
        {profileHref ? <ChatHeaderLink href={profileHref} label={profileLabel} icon={UserRoundIcon} testId="v3-inbox-profile-link" /> : null}
      </header>
      <InboxChat
        key={open.id}
        conversationId={open.id}
        person={spokenTitle}
        chat={open.chat}
        listPulse={view.listPulse}
        searchQuery={view.searchQuery}
        sort={view.sort}
        storageScope={storageScope}
        replySnippets={replySnippets}
        mediaAttachmentContext={mediaAttachmentContext}
        assistant={assistant}
      />
    </section>
  );
}
