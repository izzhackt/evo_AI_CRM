import type { LeadChannelRead } from "@/lib/lead-channel-contract";
import type { MarketingLeadFilters, MarketingLeadsRead, MarketingOverviewRead } from "@/lib/marketing-contract";
import type { MarketingView } from "@/lib/marketing-view";
import type { ReportLinkRead } from "@/lib/report-link-contract";

export type { LeadChannelRead };

/** Свойства «Маркетинга» нового вида: только данные (функции и объекты классов через границу сервер → клиент не идут). */
export type MarketingOverviewBody = Readonly<{
  kind: "overview";
  read: MarketingOverviewRead;
  recent: Readonly<{ leads: number; spendRows: number }> | null;
  range: Readonly<{ from: string; to: string }>;
  retryHref: string;
  unknownHref?: string;
  addId: string;
  /** request_id «Отменить» для каждой записи расхода: страница выдаёт их на сервере, как прежде. */
  cancelIds: Readonly<Record<string, string>>;
}>;

export type MarketingLeadsBody = Readonly<{
  kind: "leads";
  read: MarketingLeadsRead;
  period: Readonly<{ key: string; from: string; to: string }>;
  filters: MarketingLeadFilters;
  retryHref: string;
  clearHref: string;
}>;

export type MarketingReportsBody = Readonly<{ kind: "reports"; read: ReportLinkRead; retryHref: string }>;

export type MarketingNextProps = Readonly<{
  view: MarketingView;
  /** Строка под заголовком: период обзора и заявок, источник цифр у отчёта. */
  meta: string;
  tabs: readonly Readonly<{ key: string; label: string; href: string }>[];
  /** Переключатель периода; у «Отчётов» его нет. */
  period: Readonly<{
    choices: readonly Readonly<{ key: string; title: string; href: string; active: boolean }>[];
    range: Readonly<{ from: string; to: string; max: string }> | null;
    hidden: Readonly<Record<string, string>>;
  }> | null;
  body: MarketingOverviewBody | MarketingLeadsBody | MarketingReportsBody;
}>;
