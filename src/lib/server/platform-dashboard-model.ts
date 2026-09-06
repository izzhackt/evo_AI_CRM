import {
  fixedRoleCan,
  type FixedRole,
} from "../fixed-role-policy.ts";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "../platform-organization-time.ts";
import { projectPlatformTaskDeadline } from "../platform-task-deadline.ts";

type DashboardActor = Readonly<{
  presentationRole: FixedRole;
}>;

type DashboardPage<T> = Readonly<{
  rows: readonly T[];
  hasNext?: boolean;
}>;

type DashboardSalesRow = Readonly<{
  currentOwnerMembershipId: string | null;
  nextActionDueDate: string | null;
}>;

type DashboardStudentCaseItem =
  | Readonly<{
      access: "full";
      studentCase: Readonly<{
        overdueTaskCount: number;
        overdueObligationCount: number;
        rejectedDocumentCount: number;
      }>;
    }>
  | Readonly<{
      access: "sales_summary";
      studentCase: object;
    }>;

type DashboardAdmissionsTaskRow = Readonly<{
  status: string;
  dueOn: string | null;
  dueAt: string | null;
}>;

type DashboardFinanceRow = Readonly<{
  activeStopFactorCount: number;
}>;

type DashboardConversationRow = Readonly<{
  queue: "sales" | "admissions";
}>;

export type PlatformDashboardReaders<TActor extends DashboardActor> = Readonly<{
  listSalesLeads: (
    actor: TActor,
    options: Readonly<{ pageSize: number }>,
  ) => Promise<DashboardPage<DashboardSalesRow>>;
  listStudentCases: (
    actor: TActor,
    options: Readonly<{ pageSize: number }>,
  ) => Promise<DashboardPage<DashboardStudentCaseItem>>;
  listAdmissionsTasks: (
    actor: TActor,
    options: Readonly<{ pageSize: number }>,
  ) => Promise<DashboardPage<DashboardAdmissionsTaskRow>>;
  listFinanceCases: (
    actor: TActor,
  ) => Promise<DashboardPage<DashboardFinanceRow>>;
  listConversations: (
    actor: TActor,
    options: Readonly<{ pageSize: number }>,
  ) => Promise<DashboardPage<DashboardConversationRow>>;
}>;

type PlatformDashboardQueueCardBase = Readonly<{
  href: string;
  /** Сколько строк реально прочитано. */
  loadedCount: number;
  /** true — очередь длиннее прочитанного, и точных счётов у экрана нет. */
  hasMore: boolean;
}>;

export type PlatformDashboardQueueCard =
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "sales";
      overdueCount: number | null;
      unassignedCount: number | null;
    }>)
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "clients";
      attentionCount: number | null;
    }>)
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "tasks";
      overdueCount: number | null;
    }>)
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "finance";
      blockedCount: number | null;
    }>)
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "whatsapp";
      salesCount: number | null;
      admissionsCount: number | null;
    }>);

export type PlatformDashboardAttentionItem = Readonly<{
  key:
    | "sales_overdue"
    | "sales_unassigned"
    | "student_attention"
    | "admissions_overdue"
    | "finance_stops"
    | "whatsapp_open";
  href: string;
  /** null — отклонение замечено на неполной странице, точного числа нет. */
  value: number | null;
  tone: "danger" | "warn" | "info";
}>;

export type PlatformDashboardSnapshot = Readonly<{
  cards: readonly PlatformDashboardQueueCard[];
  attentionItems: readonly PlatformDashboardAttentionItem[];
}>;

const DAY_IN_ORG_TZ = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLATFORM_ORGANIZATION_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Просрочка даты-срока считается по суткам организации — ровно так же, как
 * фильтр `due=overdue` доски, куда ведёт ссылка этого счёта. Дата «сегодня»
 * не просрочена ни здесь, ни там.
 */
function isPastDue(value: string | null, now: number): boolean {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value < DAY_IN_ORG_TZ.format(new Date(now));
}

export async function readPlatformDashboardSnapshot<
  TActor extends DashboardActor,
>(
  actor: TActor,
  options: Readonly<{
    now?: number;
    readers: PlatformDashboardReaders<TActor>;
  }>,
): Promise<PlatformDashboardSnapshot> {
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("platform_dashboard_invalid_clock");

  // Admin keeps its server authority while previewing exactly the selected
  // role's product surface. Every reader still receives the authoritative
  // actor and enforces database scope at its own boundary.
  const visibleRole = actor.presentationRole;
  const canReadSales = fixedRoleCan(visibleRole, "sales.read");
  const canReadAdmissions = fixedRoleCan(visibleRole, "admissions.read");
  const canReadMessaging = fixedRoleCan(visibleRole, "messaging.read");
  const readers = options.readers;

  const [salesPage, casesPage, taskQueue, financeQueue, conversations] =
    await Promise.all([
      canReadSales ? readers.listSalesLeads(actor, { pageSize: 50 }) : null,
      canReadAdmissions ? readers.listStudentCases(actor, { pageSize: 50 }) : null,
      canReadAdmissions
        ? readers.listAdmissionsTasks(actor, { pageSize: 50 })
        : null,
      canReadAdmissions ? readers.listFinanceCases(actor) : null,
      canReadMessaging
        ? readers.listConversations(actor, { pageSize: 50 })
        : null,
    ]);

  const cards: PlatformDashboardQueueCard[] = [];
  const attentionItems: PlatformDashboardAttentionItem[] = [];

  if (salesPage) {
    const salesHasMore = salesPage.hasNext === true;
    const overdueOnPage = salesPage.rows.filter((row) =>
      isPastDue(row.nextActionDueDate, now)).length;
    const unassignedOnPage = salesPage.rows.filter(
      (row) => row.currentOwnerMembershipId === null,
    ).length;
    cards.push({
      key: "sales",
      href: "/v3/pipeline",
      loadedCount: salesPage.rows.length,
      hasMore: salesHasMore,
      overdueCount: salesHasMore ? null : overdueOnPage,
      unassignedCount: salesHasMore ? null : unassignedOnPage,
    });
    if (overdueOnPage > 0) {
      attentionItems.push({
        key: "sales_overdue",
        href: "/v3/pipeline?due=overdue",
        value: salesHasMore ? null : overdueOnPage,
        tone: "danger",
      });
    }
    if (unassignedOnPage > 0) {
      attentionItems.push({
        key: "sales_unassigned",
        href: "/v3/pipeline?assignment=unassigned",
        value: salesHasMore ? null : unassignedOnPage,
        tone: "warn",
      });
    }
  }

  if (casesPage) {
    const casesHasMore = casesPage.hasNext === true;
    const attentionOnPage = casesPage.rows.filter(
      (item) =>
        item.access === "full" &&
        (item.studentCase.overdueTaskCount > 0 ||
          item.studentCase.overdueObligationCount > 0 ||
          item.studentCase.rejectedDocumentCount > 0),
    ).length;
    cards.push({
      key: "clients",
      href: "/v3/profile",
      loadedCount: casesPage.rows.length,
      hasMore: casesHasMore,
      attentionCount: casesHasMore ? null : attentionOnPage,
    });
    if (attentionOnPage > 0) {
      attentionItems.push({
        key: "student_attention",
        href: "/v3/profile",
        value: casesHasMore ? null : attentionOnPage,
        tone: "warn",
      });
    }
  }

  if (taskQueue) {
    const tasksHasMore = taskQueue.hasNext === true;
    const overdueOnPage = taskQueue.rows.filter((row) =>
      ["open", "in_progress", "blocked"].includes(row.status) &&
      projectPlatformTaskDeadline(row.dueOn, row.dueAt, new Date(now)).overdue
    ).length;
    cards.push({
      key: "tasks",
      href: "/v3/calendar",
      loadedCount: taskQueue.rows.length,
      hasMore: tasksHasMore,
      overdueCount: tasksHasMore ? null : overdueOnPage,
    });
    if (overdueOnPage > 0) {
      attentionItems.push({
        key: "admissions_overdue",
        href: "/v3/calendar",
        value: tasksHasMore ? null : overdueOnPage,
        tone: "danger",
      });
    }
  }

  if (financeQueue) {
    const financeHasMore = financeQueue.hasNext === true;
    const blockedOnPage = financeQueue.rows.filter(
      (row) => row.activeStopFactorCount > 0,
    ).length;
    cards.push({
      key: "finance",
      href: "/v3/profile",
      loadedCount: financeQueue.rows.length,
      hasMore: financeHasMore,
      blockedCount: financeHasMore ? null : blockedOnPage,
    });
    if (blockedOnPage > 0) {
      attentionItems.push({
        key: "finance_stops",
        href: "/v3/profile",
        value: financeHasMore ? null : blockedOnPage,
        tone: "warn",
      });
    }
  }

  if (conversations) {
    const conversationsHasMore = conversations.hasNext === true;
    const salesCount = conversations.rows.filter(
      (row) => row.queue === "sales",
    ).length;
    cards.push({
      key: "whatsapp",
      href: "/v3/inbox",
      loadedCount: conversations.rows.length,
      hasMore: conversationsHasMore,
      salesCount: conversationsHasMore ? null : salesCount,
      admissionsCount: conversationsHasMore
        ? null
        : conversations.rows.length - salesCount,
    });
    if (conversations.rows.length > 0) {
      attentionItems.push({
        key: "whatsapp_open",
        href: "/v3/inbox",
        value: conversationsHasMore ? null : conversations.rows.length,
        tone: "info",
      });
    }
  }

  // Неизвестное число тяжелее любого известного: если страница неполная и
  // точного счёта нет, отклонение поднимается наверх.
  attentionItems.sort(
    (left, right) =>
      (right.value ?? Number.MAX_SAFE_INTEGER) -
        (left.value ?? Number.MAX_SAFE_INTEGER) ||
      left.key.localeCompare(right.key),
  );
  return Object.freeze({
    cards: Object.freeze(cards),
    attentionItems: Object.freeze(attentionItems),
  });
}
