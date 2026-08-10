import { Icon } from "@/components/icons";
import { PlatformMessagingRealtime } from "@/components/platform/communications/PlatformMessagingRealtime";
import { PlatformWaList } from "@/components/platform/communications/PlatformWaList";
import { PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { listPlatformConversations } from "@/lib/platform-communications";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

import { CommunicationsSourceDisclosure } from "./CommunicationsSourceDisclosure";

export default async function WhatsAppPage() {
  if (isUiContractFixtureMode()) {
    const { default: LegacyWhatsAppPage } = await import(
      "./LegacyWhatsAppPage"
    );
    return <LegacyWhatsAppPage />;
  }

  const [{ t }, actor] = await Promise.all([
    getT(),
    requirePlatformMessagingActor(),
  ]);
  const conversations = await listPlatformConversations(actor);

  return (
    <div className="space-y-4" data-testid="whatsapp-page">
      <PageHeader
        title={`${t("whatsapp")} · ${t("inbox")}`}
        description={t("aiDraftManualOnly")}
      />
      <CommunicationsSourceDisclosure
        title={t("platformCommunicationsSource")}
        description={t("platformCommunicationsSourceHint")}
        mobileSummary={t("platformCommunicationsSourceSummary")}
      />
      <PlatformMessagingRealtime organizationId={actor.organizationId} />
      <div className="flex h-[calc(100vh-310px)] min-h-[500px] overflow-hidden rounded-card border border-border bg-surface shadow-evo">
        <PlatformWaList conversations={conversations} />
        <section
          aria-labelledby="whatsapp-empty-state-title"
          className="hidden flex-1 flex-col items-center justify-center bg-bg px-8 text-center md:flex"
        >
          <span className="grid h-14 w-14 place-items-center rounded-card bg-surface-2 text-fg-3">
            <Icon name="message-circle" size={26} />
          </span>
          <h2
            id="whatsapp-empty-state-title"
            className="mt-4 text-[16px] font-bold text-fg"
          >
            {t("selectConversationTitle")}
          </h2>
          <p className="mt-2 max-w-md text-[13px] leading-5 text-fg-3">
            {t("selectConversationHint")}
          </p>
        </section>
      </div>
    </div>
  );
}
