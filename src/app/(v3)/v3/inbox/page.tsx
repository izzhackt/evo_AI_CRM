import { Inbox } from "@/components/v3/Inbox";
import { PartShell } from "@/components/v3/PartShell";
import { readInbox } from "@/lib/v3/inbox-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Входящие" };

export default async function InboxPart() {
  const threads = await readInbox();
  const messages = threads.reduce((total, thread) => total + thread.messages.length, 0);

  return (
    <PartShell
      title="Входящие"
      count={threads.length}
      lead={`${messages} сообщений в ${threads.length} диалогах, все входящие. Отвечать пока нечем: канал WhatsApp не подключён, и поле ответа выключено, а не притворяется работающим.`}
    >
      <Inbox
        threads={threads}
        canSend={false}
        cannotSendReason="Канал WhatsApp не подключён — отправлено пока ни одного сообщения. Когда канал подключат, поле включится."
      />
    </PartShell>
  );
}
