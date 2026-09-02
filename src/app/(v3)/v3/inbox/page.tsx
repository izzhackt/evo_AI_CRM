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
      lead={`${messages} сообщений в ${threads.length} диалогах, все входящие. Отвечать пока нечем: WAHA не подключена, и поле ответа выключено, а не притворяется работающим.`}
    >
      <Inbox
        threads={threads}
        canSend={false}
        cannotSendReason="WAHA не подключена: попыток отправки в базе нет ни одной. Когда канал подключат, включится и это поле."
      />
    </PartShell>
  );
}
