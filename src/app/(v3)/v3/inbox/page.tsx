import { Inbox } from "@/components/v3/Inbox";
import { PartShell } from "@/components/v3/PartShell";
import { readInbox } from "@/lib/v3/inbox-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Входящие" };

export default async function InboxPart() {
  const threads = await readInbox();

  return (
    <PartShell
      title="Входящие"
      count={threads.length}
      fill
    >
      <Inbox
        threads={threads}
        canSend={false}
      />
    </PartShell>
  );
}
