import Link from "next/link";

import { DashboardAttention } from "@/components/platform/core/DashboardAttention";
import { getDashboardCopy } from "@/components/platform/core/DashboardCopy";
import { Icon, type IconName } from "@/components/icons";
import { Card, EmptyState, PageHeader, StatCard, btnGhostCls } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import {
  readPlatformDashboardSnapshot,
  type PlatformDashboardQueueCard,
} from "@/lib/server/platform-dashboard";

const DASHBOARD_CARD_COPY = {
  ru: {
    sales: "Очередь Sales",
    clients: "Student 360",
    tasks: "Задачи Admissions",
    finance: "Финансовый контроль",
    whatsapp: "WhatsApp",
    description:
      "Командный центр теперь читает только живые продуктовые очереди Supabase и ведёт в единственный активный workflow по каждому направлению.",
    empty:
      "Для текущей роли сотрудника нет доступной активной продуктовой очереди.",
    onPage: "На текущей странице",
    overdueLeads: "Просроченные следующие действия",
    unassignedLeads: "Лиды без ответственного",
    studentAttentionCount: "Student Cases требуют внимания",
    overdueTasks: "Просроченные задачи",
    blockedCases: "Student Cases с финансовой остановкой",
    salesDialogs: "Диалоги Sales",
    admissionsDialogs: "Диалоги Admissions",
    sales_overdue: "Просроченные действия Sales",
    sales_unassigned: "Лиды без ответственного",
    student_attention: "Student 360 требует внимания",
    admissions_overdue: "Просроченные задачи Admissions",
    finance_stops: "Финансовые остановки",
    whatsapp_open: "Открытые диалоги WhatsApp",
  },
  ky: {
    sales: "Sales кезеги",
    clients: "Student 360",
    tasks: "Admissions тапшырмалары",
    finance: "Каржы көзөмөлү",
    whatsapp: "WhatsApp",
    description:
      "Командалык борбор эми Supabase ичиндеги жандуу продукт кезектерин гана окуп, ар бир багыт боюнча жалгыз активдүү workflow'го алып барат.",
    empty:
      "Учурдагы кызматкер ролу үчүн активдүү продукт кезеги жеткиликтүү эмес.",
    onPage: "Учурдагы баракта",
    overdueLeads: "Кечиккен кийинки кадамдар",
    unassignedLeads: "Жооптуусу жок лиддер",
    studentAttentionCount: "Көңүл бурууну талап кылган Student Cases",
    overdueTasks: "Кечиккен тапшырмалар",
    blockedCases: "Каржы тоскоолу бар Student Cases",
    salesDialogs: "Sales диалогдору",
    admissionsDialogs: "Admissions диалогдору",
    sales_overdue: "Sales кечиккен аракеттери",
    sales_unassigned: "Жооптуусу жок лиддер",
    student_attention: "Student 360 көңүл бурууну талап кылат",
    admissions_overdue: "Admissions кечиккен тапшырмалары",
    finance_stops: "Каржы тоскоолдуктары",
    whatsapp_open: "Ачык WhatsApp диалогдору",
  },
  en: {
    sales: "Sales queue",
    clients: "Student 360",
    tasks: "Admissions tasks",
    finance: "Finance control",
    whatsapp: "WhatsApp",
    description:
      "The command center now reads only the live Supabase product queues and links straight to the one active workflow per area.",
    empty:
      "No active product queue is available for the current staff role.",
    onPage: "On this page",
    overdueLeads: "Overdue next actions",
    unassignedLeads: "Unassigned leads",
    studentAttentionCount: "Student Cases needing attention",
    overdueTasks: "Overdue tasks",
    blockedCases: "Student Cases blocked by finance",
    salesDialogs: "Sales dialogs",
    admissionsDialogs: "Admissions dialogs",
    sales_overdue: "Overdue Sales actions",
    sales_unassigned: "Unassigned leads",
    student_attention: "Student 360 attention",
    admissions_overdue: "Overdue Admissions tasks",
    finance_stops: "Finance stops",
    whatsapp_open: "Open WhatsApp dialogs",
  },
} as const;

type DashboardCardCopy =
  (typeof DASHBOARD_CARD_COPY)[keyof typeof DASHBOARD_CARD_COPY];

const DASHBOARD_CARD_ICONS = {
  sales: "funnel",
  clients: "users",
  tasks: "check-square",
  finance: "wallet",
  whatsapp: "message-circle",
} as const satisfies Record<PlatformDashboardQueueCard["key"], IconName>;

function dashboardCardDetails(
  card: PlatformDashboardQueueCard,
  copy: DashboardCardCopy,
): string {
  switch (card.key) {
    case "sales":
      return `${copy.overdueLeads}: ${card.overdueCount} · ${copy.unassignedLeads}: ${card.unassignedCount}`;
    case "clients":
      return `${copy.studentAttentionCount}: ${card.attentionCount}`;
    case "tasks":
      return `${copy.overdueTasks}: ${card.overdueCount}`;
    case "finance":
      return `${copy.blockedCases}: ${card.blockedCount}`;
    case "whatsapp":
      return `${copy.salesDialogs}: ${card.salesCount} · ${copy.admissionsDialogs}: ${card.admissionsCount}`;
  }
}

export default async function DashboardPage() {
  const [{ t, locale }, actor] = await Promise.all([
    getT(),
    requirePlatformStaffActor(),
  ]);
  const copy = getDashboardCopy(locale);
  const dashboardCopy = DASHBOARD_CARD_COPY[locale];
  const snapshot = await readPlatformDashboardSnapshot(actor);

  return (
    <div className="space-y-5" data-testid="dashboard-page">
      <PageHeader
        title={t("commandCenter")}
        description={dashboardCopy.description}
      />

      <DashboardAttention
        copy={{
          ...copy,
          allClearHint:
            snapshot.attentionItems.length === 0
              ? (
                locale === "en"
                  ? "The visible Supabase queues do not currently show overdue work or blocked cases."
                  : locale === "ky"
                    ? "Көрүнгөн Supabase кезектеринде азырынча кечиккен иш же бөгөттөлгөн кейс көрүнбөйт."
                    : "В видимых очередях Supabase сейчас не видно просроченной работы или заблокированных кейсов."
              )
              : copy.allClearHint,
        }}
        locale={locale}
        items={snapshot.attentionItems.map((item) => ({
          href: item.href,
          label: dashboardCopy[item.key],
          value: item.value,
          icon:
            item.tone === "danger"
              ? "alert"
              : item.tone === "warn"
                ? "clock"
                : "message-circle",
          tone: item.tone === "warn" ? "warning" : item.tone,
        }))}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {snapshot.cards.map((card) => (
          <StatCard
            key={card.key}
            label={dashboardCopy[card.key]}
            value={card.totalOnPage}
            tone={
              card.key === "sales"
                ? "accent"
                : card.key === "clients"
                  ? "info"
                  : card.key === "tasks"
                    ? "warning"
                    : card.key === "finance"
                      ? "danger"
                      : "neutral"
            }
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {snapshot.cards.map((card) => (
          <Card
            key={card.key}
            title={dashboardCopy[card.key]}
            action={
              <Link
                href={card.href}
                aria-label={dashboardCopy[card.key]}
                data-testid={`dashboard-card-action-${card.key}`}
                className="inline-flex h-8 items-center gap-1 rounded-nav px-2 text-xs font-semibold text-accent hover:bg-accent-weak"
              >
                <Icon name="chevron-right" size={15} />
              </Link>
            }
          >
            <p className="text-sm font-medium text-fg">
              {dashboardCopy.onPage}: {card.totalOnPage}
            </p>
            <p className="text-sm text-fg-2">
              {dashboardCardDetails(card, dashboardCopy)}
            </p>
          </Card>
        ))}
      </div>

      {snapshot.cards.length === 0 ? (
        <Card title={t("commandCenter")}>
          <EmptyState text={dashboardCopy.empty} />
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {snapshot.cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className={btnGhostCls}
            data-testid={`dashboard-queue-link-${card.key}`}
          >
            <Icon name={DASHBOARD_CARD_ICONS[card.key]} size={15} />
            {dashboardCopy[card.key]}
          </Link>
        ))}
      </div>
    </div>
  );
}
