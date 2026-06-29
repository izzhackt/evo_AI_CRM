import { getT } from "@/lib/i18n";
import { requireStaffRoute } from "@/lib/guards";
import { AutoRefresh } from "@/components/AutoRefresh";
import { WaList } from "@/components/WaList";
import { Icon } from "@/components/icons";

export default async function WhatsAppPage() {
  await requireStaffRoute("/whatsapp");
  const { t } = await getT();

  return (
    <div className="flex h-[calc(100vh-150px)] min-h-[420px] overflow-hidden rounded-card border border-border bg-surface shadow-evo">
      <AutoRefresh intervalMs={7000} />
      <WaList />
      <div className="hidden flex-1 flex-col items-center justify-center gap-3 bg-bg text-fg-3 md:flex">
        <Icon name="message-circle" size={32} />
        <span className="text-[13px]">{t("inbox")}</span>
      </div>
    </div>
  );
}
