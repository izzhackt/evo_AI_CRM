import { PLATFORM_AUDIT_RESOURCE_TYPES } from "../platform-audit.ts";

const AUDIT_ACTOR_LABELS = ["Staff", "Service", "System"] as const;

export type JournalFilters = Readonly<{
  objectType?: string;
  role?: string;
}>;

function isAuditResourceType(
  value: string | undefined,
): value is (typeof PLATFORM_AUDIT_RESOURCE_TYPES)[number] {
  return value !== undefined && (PLATFORM_AUDIT_RESOURCE_TYPES as readonly string[]).includes(value);
}

function isAuditActorLabel(
  value: string | undefined,
): value is (typeof AUDIT_ACTOR_LABELS)[number] {
  return value !== undefined && (AUDIT_ACTOR_LABELS as readonly string[]).includes(value);
}

export function normalizeJournalFilters(filters: JournalFilters): JournalFilters {
  return {
    ...(isAuditResourceType(filters.objectType)
      ? { objectType: filters.objectType }
      : {}),
    ...(isAuditActorLabel(filters.role) ? { role: filters.role } : {}),
  };
}
