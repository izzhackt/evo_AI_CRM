import { getT } from "@/lib/i18n";
import { requireStaffRoute } from "@/lib/guards";
import { AutoRefresh } from "@/components/AutoRefresh";
import { WaList } from "@/components/WaList";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { CommunicationsSourceDisclosure } from "./CommunicationsSourceDisclosure";

export default async function WhatsAppPage() {
  const { t } = await getT();
  const actor = await requireStaffRoute("/whatsapp");

  return (
    <div className="space-y-4" data-testid="whatsapp-page">
      <PageHeader title={`${t("whatsapp")} · ${t("inbox")}`} description={t("aiDraftManualOnly")} />
      <CommunicationsSourceDisclosure
        title={t("communicationsSourceTruth")}
        description={t("communicationsSourceTruthHint")}
        mobileSummary={t("communicationsSourceSummary")}
      />
      <div className="flex h-[calc(100vh-310px)] min-h-[500px] overflow-hidden rounded-card border border-border bg-surface shadow-evo">
        <AutoRefresh intervalMs={7000} />
        <WaList actor={actor} />
        <section
          aria-labelledby="whatsapp-empty-state-title"
          className="hidden flex-1 flex-col items-center justify-center bg-bg px-8 text-center md:flex"
        >
          <span className="grid h-14 w-14 place-items-center rounded-card bg-surface-2 text-fg-3">
            <Icon name="message-circle" size={26} />
          </span>
          <h2 id="whatsapp-empty-state-title" className="mt-4 text-[16px] font-bold text-fg">
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
