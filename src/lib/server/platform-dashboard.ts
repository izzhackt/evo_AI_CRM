import "server-only";

import { listPlatformStudentCases } from "../platform-admissions.ts";
import { listPlatformAdmissionsTaskQueue } from "../platform-admissions-workspace.ts";
import { listPlatformConversations } from "../platform-communications.ts";
import { listPlatformFinanceControlQueue } from "../platform-finance-control.ts";
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
  listFinanceCases: listPlatformFinanceControlQueue,
  listConversations: listPlatformConversations,
});

export function readPlatformDashboardSnapshot(
  actor: ActivePlatformActor,
): Promise<PlatformDashboardSnapshot> {
  return readPlatformDashboardSnapshotWithReaders(actor, { readers: READERS });
}
