import "server-only";

import { listPlatformStudentCases } from "../platform-admissions.ts";
import { listPlatformAdmissionsTaskQueue } from "../platform-admissions-workspace.ts";
import { listPlatformConversations } from "../platform-communications.ts";
import {
  PLATFORM_FINANCE_QUEUE_PAGE_LIMIT,
  listPlatformFinanceControlQueue,
} from "../platform-finance-control.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import { listPlatformSalesLeads } from "../platform-sales.ts";
import {
  readPlatformDashboardSnapshot as readPlatformDashboardSnapshotWithReaders,
  type PlatformDashboardReaders,
  type PlatformDashboardSnapshot,
} from "./platform-dashboard-model.ts";

export type {
  PlatformDashboardAttentionItem,
  PlatformDashboardQueueCard,
  PlatformDashboardSnapshot,
} from "./platform-dashboard-model.ts";

const READERS: PlatformDashboardReaders<ActivePlatformActor> = Object.freeze({
  listSalesLeads: listPlatformSalesLeads,
  listStudentCases: listPlatformStudentCases,
  listAdmissionsTasks: listPlatformAdmissionsTaskQueue,
  // Финансовый RPC читает одну страницу и признака hasNext не отдаёт.
  // Полная страница означает «возможно, есть ещё» — и карточка честно
  // показывает «100+» вместо точного числа, которого у чтения нет.
  listFinanceCases: async (actor) => {
    const rows = await listPlatformFinanceControlQueue(actor);
    return {
      rows,
      hasNext: rows.length >= PLATFORM_FINANCE_QUEUE_PAGE_LIMIT,
    };
  },
  listConversations: listPlatformConversations,
});

export function readPlatformDashboardSnapshot(
  actor: ActivePlatformActor,
): Promise<PlatformDashboardSnapshot> {
  return readPlatformDashboardSnapshotWithReaders(actor, { readers: READERS });
}
