import Link from "next/link";

import { SalesSourceTruth } from "@/components/platform/core/SalesSourceTruth";
import type { SalesCopy } from "@/components/platform/core/SalesCopy";
import {
  EmptyState,
  PageHeader,
  StatCard,
  btnGhostCls,
  cn,
} from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { PlatformConversationSummary } from "@/lib/platform-communications";

const LOCALE_TAG: Record<Locale, string> = {
  ru: "ru-RU",
  ky: "ky-KG",
  en: "en-US",
};

const CONNECTED_SALES_COPY: Record<
  Locale,
  Readonly<{
    description: string;
    sourceBody: string;
    workflowApproved: string;
    workflowMissing: string;
    queueTitle: string;
    queueHint: string;
    onPage: string;
    openOnPage: string;
    linkedCases: string;
    workflow: string;
    inquiry: string;
    status: string;
    case: string;
    channel: string;
    activity: string;
    open: string;
    closed: string;
    noCase: string;
    empty: string;
    allMessages: string;
    firstPage: string;
    older: string;
  }>
> = {
  ru: {
    description:
      "Реальная входящая очередь продаж EVO Admissions. Это рабочие обращения единой платформы, а не каноническая воронка amoCRM.",
    sourceBody:
      "amoCRM остаётся источником истины для сделки, этапа, суммы и ответственного менеджера. Здесь показана read-only очередь обращений из единого рабочего процесса EVO; локальные сделки из них не создаются.",
    workflowApproved: "Контракт OP утверждён",
    workflowMissing: "Контракт OP не утверждён",
    queueTitle: "Входящая очередь продаж",
    queueHint:
      "Порядок задан сервером по последней активности. Откройте обращение, чтобы продолжить работу в WhatsApp.",
    onPage: "На странице",
    openOnPage: "Открытые",
    linkedCases: "Связаны с клиентом",
    workflow: "Контракт OP",
    inquiry: "Обращение",
    status: "Статус",
    case: "Клиент",
    channel: "Канал",
    activity: "Последняя активность",
    open: "Открыто",
    closed: "Закрыто",
    noCase: "Ещё не связан",
    empty: "В доступной sales-очереди обращений пока нет.",
    allMessages: "Вся переписка",
    firstPage: "К началу",
    older: "Более старые",
  },
  ky: {
    description:
      "EVO Admissions бирдиктүү платформасындагы чыныгы кирүүчү сатуу кезеги. Бул amoCRM'деги расмий воронка эмес, иштөөчү кайрылуулар.",
    sourceBody:
      "amoCRM бүтүм, этап, сумма жана жооптуу менеджер үчүн негизги булак бойдон калат. Бул жерде EVO'нун бирдиктүү иш процессиндеги read-only кайрылуулар көрсөтүлөт; алардан жергиликтүү бүтүм түзүлбөйт.",
    workflowApproved: "OP келишими бекитилген",
    workflowMissing: "OP келишими бекитилген эмес",
    queueTitle: "Кирүүчү сатуу кезеги",
    queueHint:
      "Тартип серверде акыркы активдүүлүк боюнча берилет. WhatsApp'та ишти улантуу үчүн кайрылууну ачыңыз.",
    onPage: "Бул бетте",
    openOnPage: "Ачык",
    linkedCases: "Кардарга байланышкан",
    workflow: "OP келишими",
    inquiry: "Кайрылуу",
    status: "Абалы",
    case: "Кардар",
    channel: "Канал",
    activity: "Акыркы активдүүлүк",
    open: "Ачык",
    closed: "Жабык",
    noCase: "Азырынча байланышкан эмес",
    empty: "Жеткиликтүү сатуу кезегинде азырынча кайрылуу жок.",
    allMessages: "Бардык кат алышуу",
    firstPage: "Башына",
    older: "Эскирээк",
  },
  en: {
    description:
      "The real EVO Admissions sales-intake queue. These are inquiries in one unified workflow, not the canonical amoCRM pipeline.",
    sourceBody:
      "amoCRM remains authoritative for the deal, stage, amount, and responsible manager. This page shows read-only inquiries from EVO's unified workflow; it does not manufacture local deals from them.",
    workflowApproved: "OP contract approved",
    workflowMissing: "OP contract not approved",
    queueTitle: "Sales intake queue",
    queueHint:
      "Server order follows latest activity. Open an inquiry to continue the work in WhatsApp.",
    onPage: "On this page",
    openOnPage: "Open",
    linkedCases: "Linked to a client",
    workflow: "OP contract",
    inquiry: "Inquiry",
    status: "Status",
    case: "Client",
    channel: "Channel",
    activity: "Latest activity",
    open: "Open",
    closed: "Closed",
    noCase: "Not linked yet",
    empty: "There are no inquiries in the accessible sales queue yet.",
    allMessages: "All conversations",
    firstPage: "Back to first",
    older: "Older inquiries",
  },
};

function formatTimestamp(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ConnectedSalesIntake({
  locale,
  salesCopy,
  t,
  workflowVersion,
  conversations,
  isFirstPage,
  nextHref,
}: Readonly<{
  locale: Locale;
  salesCopy: SalesCopy;
  t: (key: string) => string;
  workflowVersion: number | null;
  conversations: readonly PlatformConversationSummary[];
  isFirstPage: boolean;
  nextHref: string | null;
}>) {
  const copy = CONNECTED_SALES_COPY[locale];
  const openCount = conversations.filter(
    (conversation) => conversation.status === "open",
  ).length;
  const linkedCount = conversations.filter(
    (conversation) => conversation.studentCaseId !== null,
  ).length;
  const workflowLabel = workflowVersion
    ? `${copy.workflowApproved} · v${workflowVersion}`
    : copy.workflowMissing;

  return (
    <div className="min-w-0 space-y-5" data-testid="platform-sales-page">
      <PageHeader
        title={t("admissionsPipeline")}
        description={copy.description}
        action={
          <Link href="/whatsapp" className={btnGhostCls}>
            {copy.allMessages}
          </Link>
        }
      />

      <SalesSourceTruth
        copy={salesCopy}
        title={t("leadSourceTruthTitle")}
        body={`${copy.sourceBody} ${workflowLabel}.`}
        syncLabel={t("amocrmBlocked")}
      />

      <section aria-label={copy.queueTitle}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={copy.onPage} value={conversations.length} tone="accent" />
          <StatCard label={copy.openOnPage} value={openCount} tone="success" />
          <StatCard label={copy.linkedCases} value={linkedCount} tone="info" />
          <StatCard
            label={copy.workflow}
            value={workflowVersion ? `v${workflowVersion}` : "—"}
            tone="warning"
          />
        </div>
      </section>

      <section
        aria-labelledby="platform-sales-intake-title"
        className="space-y-3"
        data-testid="platform-sales-intake"
      >
        <header>
          <h2
            id="platform-sales-intake-title"
            className="text-[15px] font-semibold text-fg"
          >
            {copy.queueTitle}
          </h2>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-fg-3">
            {copy.queueHint}
          </p>
        </header>

        {conversations.length === 0 ? (
          <div className="rounded-card border border-border bg-surface px-5 py-4 shadow-evo">
            <EmptyState text={copy.empty} />
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-card border border-border bg-surface shadow-evo">
            <table className="w-full min-w-[760px] text-left text-[12.5px]">
              <thead className="border-b border-border bg-surface-2 text-[10.5px] uppercase tracking-[0.04em] text-fg-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">{copy.inquiry}</th>
                  <th className="px-3 py-3 font-semibold">{copy.status}</th>
                  <th className="px-3 py-3 font-semibold">{copy.case}</th>
                  <th className="px-3 py-3 font-semibold">{copy.channel}</th>
                  <th className="px-4 py-3 font-semibold">{copy.activity}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {conversations.map((conversation) => (
                  <tr
                    key={conversation.id}
                    className="transition-[background-color] hover:bg-surface-2"
                    data-testid="platform-sales-intake-row"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/whatsapp/${conversation.id}`}
                        className="font-semibold text-fg hover:text-accent"
                      >
                        {conversation.subject}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          conversation.status === "open"
                            ? "bg-ok-weak text-ok"
                            : "bg-surface-2 text-fg-3",
                        )}
                      >
                        {conversation.status === "open" ? copy.open : copy.closed}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-fg-2">
                      {conversation.studentCaseId ? (
                        <Link
                          href={`/clients/${conversation.studentCaseId}`}
                          className="font-medium text-accent hover:underline"
                        >
                          {copy.linkedCases}
                        </Link>
                      ) : (
                        copy.noCase
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11.5px] text-fg-3">
                      {conversation.wahaSessionName}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11.5px] text-fg-3">
                      {formatTimestamp(conversation.sortAt, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <nav
          aria-label={copy.queueTitle}
          className="flex flex-wrap items-center justify-end gap-2"
        >
          {!isFirstPage && (
            <Link href="/sales" className={btnGhostCls}>
              {copy.firstPage}
            </Link>
          )}
          {nextHref && (
            <Link href={nextHref} className={btnGhostCls} rel="next">
              {copy.older}
            </Link>
          )}
        </nav>
      </section>
    </div>
  );
}
