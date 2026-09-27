import type { ConversationChannel, ConversationChannelKey } from "@/lib/v3/navigation";

import { QueueViewTabs } from "./queue/QueueViewTabs";

/**
 * Каналы «Переписок» (Э5 плана редизайна, 27.09.2026) под заголовком
 * страницы: «Кабинет студента» и WhatsApp — настоящие ссылки на свои
 * страницы с `aria-current="page"`. Только каналы, которые роль открывает
 * (`conversationChannels`); у каждой страницы своя серверная проверка.
 * Вкладки — только когда каналов два: одна вкладка ничего не выбирает, и
 * роль с одним каналом видит страницу без ряда вкладок.
 * Число — только у текущего канала и только если его дало чтение страницы.
 */
export function ConversationChannels({
  channels,
  current,
  count = null,
}: Readonly<{
  channels: readonly ConversationChannel[];
  current: ConversationChannelKey;
  /** Число текущего канала из чтения его страницы; null — числа нет. */
  count?: number | null;
}>) {
  if (channels.length < 2) return null;
  return (
    <QueueViewTabs
      label="Каналы переписки"
      tabs={channels.map((channel) => ({
        key: channel.key,
        label: channel.label,
        href: channel.href,
        count: channel.key === current ? count : null,
        current: channel.key === current,
      }))}
    />
  );
}
