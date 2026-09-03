import {
  fixedRoleCan,
  type FixedRole,
} from "../fixed-role-policy.ts";

type DashboardActor = Readonly<{
  presentationRole: FixedRole;
}>;

type DashboardPage<T> = Readonly<{
  rows: readonly T[];
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
  ) => Promise<readonly DashboardFinanceRow[]>;
  listConversations: (
    actor: TActor,
    options: Readonly<{ pageSize: number }>,
  ) => Promise<DashboardPage<DashboardConversationRow>>;
}>;

type PlatformDashboardQueueCardBase = Readonly<{
  href: string;
  totalOnPage: number;
}>;

export type PlatformDashboardQueueCard =
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "sales";
      overdueCount: number;
      unassignedCount: number;
    }>)
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "clients";
      attentionCount: number;
    }>)
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "tasks";
      overdueCount: number;
    }>)
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "finance";
      blockedCount: number;
    }>)
  | (PlatformDashboardQueueCardBase & Readonly<{
      key: "whatsapp";
      salesCount: number;
      admissionsCount: number;
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
  value: number;
  tone: "danger" | "warn" | "info";
}>;

export type PlatformDashboardSnapshot = Readonly<{
  cards: readonly PlatformDashboardQueueCard[];
  attentionItems: readonly PlatformDashboardAttentionItem[];
}>;

function isPastDue(value: string | null, now: number): boolean {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) && parsed < now;
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
    const overdueCount = salesPage.rows.filter((row) =>
      isPastDue(row.nextActionDueDate, now)).length;
    const unassignedCount = salesPage.rows.filter(
      (row) => row.currentOwnerMembershipId === null,
    ).length;
    cards.push({
      key: "sales",
      href: "/sales",
      totalOnPage: salesPage.rows.length,
      overdueCount,
      unassignedCount,
    });
    if (overdueCount > 0) {
      attentionItems.push({
        key: "sales_overdue",
        href: "/sales?due=overdue",
        value: overdueCount,
        tone: "danger",
      });
    }
    if (unassignedCount > 0) {
      attentionItems.push({
        key: "sales_unassigned",
        href: "/sales",
        value: unassignedCount,
        tone: "warn",
      });
    }
  }

  if (casesPage) {
    const attentionCount = casesPage.rows.filter(
      (item) =>
        item.access === "full" &&
        (item.studentCase.overdueTaskCount > 0 ||
          item.studentCase.overdueObligationCount > 0 ||
          item.studentCase.rejectedDocumentCount > 0),
    ).length;
    cards.push({
      key: "clients",
      href: "/clients",
      totalOnPage: casesPage.rows.length,
      attentionCount,
    });
    if (attentionCount > 0) {
      attentionItems.push({
        key: "student_attention",
        href: "/clients",
        value: attentionCount,
        tone: "warn",
      });
    }
  }

  if (taskQueue) {
    const overdueCount = taskQueue.rows.filter(
      (row) => row.status !== "done" && isPastDue(row.dueAt, now),
    ).length;
    cards.push({
      key: "tasks",
      href: "/tasks",
      totalOnPage: taskQueue.rows.length,
      overdueCount,
    });
    if (overdueCount > 0) {
      attentionItems.push({
        key: "admissions_overdue",
        href: "/tasks",
        value: overdueCount,
        tone: "danger",
      });
    }
  }

  if (financeQueue) {
    const blockedCount = financeQueue.filter(
      (row) => row.activeStopFactorCount > 0,
    ).length;
    cards.push({
      key: "finance",
      href: "/finance",
      totalOnPage: financeQueue.length,
      blockedCount,
    });
    if (blockedCount > 0) {
      attentionItems.push({
        key: "finance_stops",
        href: "/finance",
        value: blockedCount,
        tone: "warn",
      });
    }
  }

  if (conversations) {
    const salesCount = conversations.rows.filter(
      (row) => row.queue === "sales",
    ).length;
    cards.push({
      key: "whatsapp",
      href: "/whatsapp",
      totalOnPage: conversations.rows.length,
      salesCount,
      admissionsCount: conversations.rows.length - salesCount,
    });
    if (conversations.rows.length > 0) {
      attentionItems.push({
        key: "whatsapp_open",
        href: "/whatsapp",
        value: conversations.rows.length,
        tone: "info",
      });
    }
  }

  attentionItems.sort(
    (left, right) =>
      right.value - left.value || left.key.localeCompare(right.key),
  );
  return Object.freeze({
    cards: Object.freeze(cards),
    attentionItems: Object.freeze(attentionItems),
  });
}
