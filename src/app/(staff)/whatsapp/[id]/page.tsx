import { notFound } from "next/navigation";

import { PlatformConversationView } from "@/components/platform/communications/PlatformConversationView";
import { getT } from "@/lib/i18n";
import {
  getPlatformConversationThread,
  isPlatformConversationId,
  listPlatformConversations,
} from "@/lib/platform-communications";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import {
  getPlatformConversationWorkflow,
  listApprovedPlatformKnowledge,
} from "@/lib/platform-messaging-workflow";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

import { CommunicationsSourceDisclosure } from "../CommunicationsSourceDisclosure";

type ConversationSearchParams = Promise<{ mode?: string | string[] }>;

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: ConversationSearchParams;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacyConversationPage } = await import(
      "./LegacyConversationPage"
    );
    return (
      <LegacyConversationPage
        params={params}
        searchParams={searchParams}
      />
    );
  }

  const [{ id }, { t }, actor] = await Promise.all([
    params,
    getT(),
    requirePlatformMessagingActor(),
  ]);
  if (!isPlatformConversationId(id)) notFound();

  const [conversations, thread, workflow, knowledge] = await Promise.all([
    listPlatformConversations(actor),
    getPlatformConversationThread(actor, id),
    getPlatformConversationWorkflow(actor, id),
    listApprovedPlatformKnowledge(actor),
  ]);
  if (!thread || !workflow) notFound();

  return (
    <div className="space-y-4" data-testid="whatsapp-conversation">
      <CommunicationsSourceDisclosure
        title={t("platformCommunicationsSource")}
        description={t("platformCommunicationsSourceHint")}
        mobileSummary={t("platformCommunicationsSourceSummary")}
      />
      <PlatformConversationView
        conversations={conversations}
        conversation={thread.conversation}
        messages={thread.messages}
        workflow={workflow}
        knowledge={knowledge}
      />
    </div>
  );
}
