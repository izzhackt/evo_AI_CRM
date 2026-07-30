import { getT } from "@/lib/i18n";
import { requireStaffRoute } from "@/lib/guards";
import { AutoRefresh } from "@/components/AutoRefresh";
import { WaList } from "@/components/WaList";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { CommunicationsSourceDisclosure } from "./CommunicationsSourceDisclosure";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";
import type { Locale } from "@/lib/i18n-data";

const PLATFORM_EMPTY_COPY: Record<
  Locale,
  {
    title: string;
    description: string;
    sourceTitle: string;
    sourceDescription: string;
    sourceSummary: string;
  }
> = {
  ru: {
    title: "Сообщения пока не подключены",
    description:
      "Ваш доступ к EVO Platform проверен через Supabase. Хранилище диалогов и отправка WhatsApp ещё не подключены в этом окружении. Никакие сообщения не отправлялись.",
    sourceTitle: "Источник данных EVO Platform",
    sourceDescription:
      "Авторизация работает через Supabase. Диалоги из legacy CRM не читаются, а Platform-репозиторий сообщений пока не подключён.",
    sourceSummary: "Supabase Auth · диалоги не подключены",
  },
  ky: {
    title: "Билдирүүлөр азырынча туташкан эмес",
    description:
      "EVO Platform'га кирүү укугуңуз Supabase аркылуу текшерилди. Бул чөйрөдө диалогдордун сактагычы жана WhatsApp жөнөтүү али туташкан эмес. Эч кандай билдирүү жөнөтүлгөн жок.",
    sourceTitle: "EVO Platform маалымат булагы",
    sourceDescription:
      "Авторизация Supabase аркылуу иштейт. Legacy CRM диалогдору окулбайт, ал эми Platform билдирүү репозиторийи азырынча туташкан эмес.",
    sourceSummary: "Supabase Auth · диалогдор туташкан эмес",
  },
  en: {
    title: "Messaging is not connected yet",
    description:
      "Your EVO Platform access was verified through Supabase. Conversation storage and WhatsApp sending are not connected in this environment yet. No message was sent.",
    sourceTitle: "EVO Platform data source",
    sourceDescription:
      "Authentication runs through Supabase. Legacy CRM conversations are not read, and the Platform messaging repository is not connected yet.",
    sourceSummary: "Supabase Auth · conversations not connected",
  },
};

export default async function WhatsAppPage() {
  const { t, locale } = await getT();
  if (!isUiContractFixtureMode()) {
    await requirePlatformMessagingActor();
    const copy = PLATFORM_EMPTY_COPY[locale];
    return (
      <div className="space-y-4" data-testid="whatsapp-page">
        <PageHeader
          title={`${t("whatsapp")} · ${t("inbox")}`}
          description={t("aiDraftManualOnly")}
        />
        <CommunicationsSourceDisclosure
          title={copy.sourceTitle}
          description={copy.sourceDescription}
          mobileSummary={copy.sourceSummary}
        />
        <section
          aria-labelledby="platform-whatsapp-empty-title"
          className="flex min-h-[500px] flex-col items-center justify-center rounded-card border border-border bg-surface px-8 text-center shadow-evo"
          data-testid="platform-authenticated-empty-state"
        >
          <span className="grid h-14 w-14 place-items-center rounded-card bg-surface-2 text-fg-3">
            <Icon name="message-circle" size={26} />
          </span>
          <h2
            id="platform-whatsapp-empty-title"
            className="mt-4 text-[16px] font-bold text-fg"
          >
            {copy.title}
          </h2>
          <p className="mt-2 max-w-xl text-[13px] leading-5 text-fg-3">
            {copy.description}
          </p>
        </section>
      </div>
    );
  }

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
