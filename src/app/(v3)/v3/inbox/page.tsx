import { Inbox } from "@/components/v3/Inbox";
import { PartShell } from "@/components/v3/PartShell";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import { readInbox } from "@/lib/v3/inbox-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Входящие" };

export default async function InboxPart() {
  const actor = await requirePlatformMessagingActor();
  const threads = await readInbox(actor);

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
