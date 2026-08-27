import { Icon } from "@/components/icons";
import { PlatformMessagingRealtime } from "@/components/platform/communications/PlatformMessagingRealtime";
import { PlatformWaList } from "@/components/platform/communications/PlatformWaList";
import { PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import {
  listPlatformConversations,
  parsePlatformConversationCursor,
} from "@/lib/platform-communications";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

import { CommunicationsSourceDisclosure } from "./CommunicationsSourceDisclosure";

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{
    before_at?: string | string[];
    before_id?: string | string[];
  }>;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacyWhatsAppPage } = await import(
      "./LegacyWhatsAppPage"
    );
    return <LegacyWhatsAppPage />;
  }

  const [{ t }, actor, query] = await Promise.all([
    getT(),
    requirePlatformMessagingActor(),
    searchParams,
  ]);
  const supabaseConfig = getSupabasePublicConfig();
  const cursor = parsePlatformConversationCursor(query.before_at, query.before_id);
  const conversations = await listPlatformConversations(actor, {
    cursor,
    pageSize: 50,
  });

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
      <PlatformMessagingRealtime
        organizationId={actor.organizationId}
        supabaseConfig={supabaseConfig}
      />
      <div className="flex h-[calc(100vh-310px)] min-h-[500px] overflow-hidden rounded-card border border-border bg-surface shadow-evo">
        <PlatformWaList
          conversations={conversations.rows}
          resetHref={cursor ? "/whatsapp" : null}
          nextHref={conversations.nextCursor
            ? whatsappPageHref(conversations.nextCursor.sortAt, conversations.nextCursor.id)
            : null}
        />
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

function whatsappPageHref(sortAt: string, id: string): string {
  const params = new URLSearchParams({ before_at: sortAt, before_id: id });
  return `/whatsapp?${params.toString()}`;
}
