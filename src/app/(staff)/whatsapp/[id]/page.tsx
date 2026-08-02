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
import { getPlatformConversationBw4Workspace } from "@/lib/platform-bw4-workflow";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

import { CommunicationsSourceDisclosure } from "../CommunicationsSourceDisclosure";

type ConversationSearchParams = Promise<{
  mode?: string | string[];
  result?: string | string[];
}>;

function decisionMutationOutcome(value: string | string[] | undefined) {
  if (value === "saved" || value === "invalid" || value === "unavailable") {
    return value;
  }
  return null;
}

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

  const [{ id }, resolvedSearchParams, { t }, actor] = await Promise.all([
    params,
    searchParams,
    getT(),
    requirePlatformMessagingActor(),
  ]);
  if (!isPlatformConversationId(id)) notFound();

  const [conversations, thread, workflow, knowledge, bw4Workspace] =
    await Promise.all([
      listPlatformConversations(actor),
      getPlatformConversationThread(actor, id),
      getPlatformConversationWorkflow(actor, id),
      listApprovedPlatformKnowledge(actor),
      getPlatformConversationBw4Workspace(actor, id).catch(() => null),
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
        bw4Workspace={bw4Workspace}
        decisionMutationOutcome={decisionMutationOutcome(
          resolvedSearchParams.result,
        )}
      />
    </div>
  );
}
